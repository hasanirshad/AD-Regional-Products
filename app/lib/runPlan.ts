// The safe way to run a reviewed MovePlan:
//   recheck (nothing changed since the review) -> apply -> read back from Shopify -> report rows.
// Writes happen only inside applyMove, which is only reachable from a screen that asked for the password.

import { applyMove, type MoveResult, type Progress } from "./applyMove";
import type { RunEngine } from "./engine";
import type { MoveLine, MovePlan } from "./move";
import { findDrift, findMismatch, readState, type Finding } from "./readback";
import type { ReportRow } from "./report";

const RETRY_WAIT_MS = 1500;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The same plan, limited to some of its lines. */
export function subPlan(plan: MovePlan, lines: MoveLine[]): MovePlan {
  return { ...plan, lines };
}

const idsOf = (lines: MoveLine[]) => lines.map((l) => l.product.id);
const movingIds = (lines: MoveLine[]) => lines.filter((l) => l.shippingChange).map((l) => l.product.id);

/** Reads the products again and reports what changed since the review. Writes nothing. */
export async function recheckPlan(plan: MovePlan): Promise<Finding[]> {
  const state = await readState(idsOf(plan.lines), movingIds(plan.lines));
  return findDrift(plan.lines, state);
}

function labelBefore(l: MoveLine): string {
  const cats = l.product.catalogs.map((c) => c.title).join(", ") || "none";
  return `Profile: ${l.from}; catalogues: ${cats}`;
}

function labelAfter(l: MoveLine, targetName: string, applied: boolean): string {
  if (!applied) return labelBefore(l);
  const removed = new Set(l.changes.filter((c) => c.kind === "unpublish").map((c) => c.catalog.title));
  const kept = l.product.catalogs.map((c) => c.title).filter((t) => !removed.has(t));
  const all = [...kept, ...l.changes.filter((c) => c.kind === "publish").map((c) => c.catalog.title)];
  return `Profile: ${l.shippingChange ? targetName : l.from}; catalogues: ${all.join(", ") || "none"}`;
}

export type RunOutcome = {
  rows: ReportRow[];
  move: MoveResult;
  /** True when every product that was applied was confirmed by reading it back. */
  allVerified: boolean;
};

/**
 * Applies the plan, then reads every finished product back from Shopify.
 * A product is "done" only when Shopify shows the change; "not verified" when it answered ok but still shows the old state.
 */
export async function runPlan(
  plan: MovePlan,
  options: {
    onProgress: (p: Progress) => void;
    shouldStop: () => boolean;
    onStage?: (s: "applying" | "verifying") => void;
    /** Wait before looking a second time at products that did not match. Default 1.5 s. */
    retryWaitMs?: number;
  },
): Promise<RunOutcome> {
  options.onStage?.("applying");
  const move = await applyMove(plan, { onProgress: options.onProgress, shouldStop: options.shouldStop });

  options.onStage?.("verifying");
  const finished = plan.lines.filter((l) => move.succeeded.includes(l.product.id));
  let mismatches: Finding[] = [];
  let readError = "";
  try {
    const read = () => readState(idsOf(finished), movingIds(finished));
    mismatches = findMismatch(finished, await read(), plan.target.key, plan.target.name);
    if (mismatches.length > 0) {
      // Shopify can lag a moment behind a write: look once more before calling it a failure.
      await wait(options.retryWaitMs ?? RETRY_WAIT_MS);
      const bad = new Set(mismatches.map((m) => m.productId));
      const again = finished.filter((l) => bad.has(l.product.id));
      mismatches = findMismatch(again, await readState(idsOf(again), movingIds(again)), plan.target.key, plan.target.name);
    }
  } catch (err) {
    readError = err instanceof Error ? err.message : String(err);
  }

  const mismatchBy = new Map(mismatches.map((m) => [m.productId, m.message]));
  const failureBy = new Map(move.failures.map((f) => [f.productId, f.message]));
  const rows: ReportRow[] = plan.lines.map((l) => {
    const added = l.changes.filter((c) => c.kind === "publish").map((c) => `${c.market.name}: ${c.catalog.title}`);
    const removed = l.changes.filter((c) => c.kind === "unpublish").map((c) => `${c.market.name}: ${c.catalog.title}`);
    const base = { productId: l.product.id, title: l.product.title, handle: l.product.handle, added, removed };
    const failure = failureBy.get(l.product.id);
    if (failure !== undefined) return { ...base, before: labelBefore(l), after: labelBefore(l), added: [], removed: [], status: "failed", message: failure };
    if (!move.succeeded.includes(l.product.id)) {
      return { ...base, before: labelBefore(l), after: labelBefore(l), added: [], removed: [], status: "not applied", message: "Not reached (stopped)." };
    }
    if (readError) return { ...base, before: labelBefore(l), after: "unknown", status: "not verified", message: `Could not read it back: ${readError}` };
    const mismatch = mismatchBy.get(l.product.id);
    if (mismatch) return { ...base, before: labelBefore(l), after: "see message", status: "not verified", message: mismatch };
    return { ...base, before: labelBefore(l), after: labelAfter(l, plan.target.name, true), status: "done", message: "" };
  });

  return { rows, move, allVerified: rows.every((r) => r.status === "done" || r.status === "not applied") && !readError };
}

/** The move plan as something the shared apply screen can run. */
export function moveEngine(plan: MovePlan): RunEngine<MoveLine> {
  return {
    lines: plan.lines,
    recheck: (lines) => recheckPlan(subPlan(plan, lines)),
    run: (lines, hooks) => runPlan(subPlan(plan, lines), hooks),
    describe: (l) => ({ productId: l.product.id, title: l.product.title, handle: l.product.handle }),
  };
}
