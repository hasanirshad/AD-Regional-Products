// Runs a reviewed PubPlan: publish / unpublish products on sales channels and catalogues, then reads every product back.
// Writes happen only here, and only from a screen that asked for the password.

import { adminGraphql, assertNoUserErrors } from "./admin";
import { PUBLISH, UNPUBLISH, type Progress } from "./applyMove";
import { labelsIn, type PubLine, type PubPlan } from "./channels";
import type { RunEngine, RunHooks } from "./engine";
import { readPublications, type Finding, type PublicationState } from "./readback";
import type { ReportRow } from "./report";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** BEFORE Apply: has any product changed since the review was built? */
export function findPublishDrift(lines: PubLine[], state: Record<string, PublicationState>): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const s = state[l.product.id];
    const title = l.product.title;
    if (!s) out.push({ productId: l.product.id, title, message: "Product not found. It may have been deleted." });
    else if (s.status !== l.status) out.push({ productId: l.product.id, title, message: `Status changed from ${l.status} to ${s.status}.` });
    else if (!sameSet(s.publicationIds, l.current)) out.push({ productId: l.product.id, title, message: "Its channels or catalogues changed since the review." });
  }
  return out;
}

/** AFTER Apply: does Shopify show what was asked? Empty = yes. */
export function findPublishMismatch(lines: PubLine[], state: Record<string, PublicationState>): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const s = state[l.product.id];
    const title = l.product.title;
    if (!s) {
      out.push({ productId: l.product.id, title, message: "Could not read the product back." });
      continue;
    }
    for (const c of l.changes) {
      const has = s.publicationIds.includes(c.target.id);
      if (c.op === "publish" && !has) out.push({ productId: l.product.id, title, message: `Not published to ${c.target.label} after the change.` });
      if (c.op === "unpublish" && has) out.push({ productId: l.product.id, title, message: `Still published to ${c.target.label} after the change.` });
    }
  }
  return out;
}

export async function recheckPublish(lines: PubLine[]): Promise<Finding[]> {
  return findPublishDrift(lines, await readPublications(lines.map((l) => l.product.id)));
}

type Applied = { succeeded: string[]; failures: Map<string, string>; stopped: boolean };

/** One call per product for all its publishes and one for all its unpublishes. */
async function applyLines(lines: PubLine[], hooks: Pick<RunHooks, "onProgress" | "shouldStop">): Promise<Applied> {
  const out: Applied = { succeeded: [], failures: new Map(), stopped: false };
  let done = 0;
  hooks.onProgress({ phase: "publishing", done, total: lines.length } satisfies Progress);
  for (const l of lines) {
    if (hooks.shouldStop()) {
      out.stopped = true;
      break;
    }
    const inputOf = (op: "publish" | "unpublish") => l.changes.filter((c) => c.op === op).map((c) => ({ publicationId: c.target.id }));
    const publish = inputOf("publish");
    const unpublish = inputOf("unpublish");
    try {
      if (publish.length > 0) {
        const d = await adminGraphql<{ publishablePublish: { userErrors: { message: string }[] } }>(PUBLISH, { id: l.product.id, input: publish });
        assertNoUserErrors(d.publishablePublish.userErrors, "Publishing");
      }
      if (unpublish.length > 0) {
        const d = await adminGraphql<{ publishableUnpublish: { userErrors: { message: string }[] } }>(UNPUBLISH, { id: l.product.id, input: unpublish });
        assertNoUserErrors(d.publishableUnpublish.userErrors, "Unpublishing");
      }
      out.succeeded.push(l.product.id);
    } catch (err) {
      out.failures.set(l.product.id, message(err));
    }
    done++;
    hooks.onProgress({ phase: "publishing", done, total: lines.length });
  }
  return out;
}

/** Applies the lines, reads them back, and returns one report row per line. */
export async function runPublish(plan: Pick<PubPlan, "targets">, lines: PubLine[], hooks: RunHooks): Promise<{ rows: ReportRow[] }> {
  hooks.onStage?.("applying");
  const applied = await applyLines(lines, hooks);

  hooks.onStage?.("verifying");
  const finished = lines.filter((l) => applied.succeeded.includes(l.product.id));
  let mismatches: Finding[] = [];
  let readError = "";
  try {
    mismatches = findPublishMismatch(finished, await readPublications(finished.map((l) => l.product.id)));
    if (mismatches.length > 0) {
      await wait(hooks.retryWaitMs ?? 1500);
      const bad = new Set(mismatches.map((m) => m.productId));
      const again = finished.filter((l) => bad.has(l.product.id));
      mismatches = findPublishMismatch(again, await readPublications(again.map((l) => l.product.id)));
    }
  } catch (err) {
    readError = message(err);
  }
  const mismatchBy = new Map(mismatches.map((m) => [m.productId, m.message]));

  const rows = lines.map((l): ReportRow => {
    const before = labelsIn(l.current, plan.targets);
    const added = l.changes.filter((c) => c.op === "publish").map((c) => c.target.label);
    const removed = l.changes.filter((c) => c.op === "unpublish").map((c) => c.target.label);
    const after = [...before.filter((b) => !removed.includes(b)), ...added];
    const base = { productId: l.product.id, title: l.product.title, handle: l.product.handle, added, removed };
    const text = (labels: string[]) => `Published to: ${labels.join(", ") || "none"}`;
    const failure = applied.failures.get(l.product.id);
    if (failure !== undefined) return { ...base, before: text(before), after: text(before), added: [], removed: [], status: "failed", message: failure };
    if (!applied.succeeded.includes(l.product.id)) {
      return { ...base, before: text(before), after: text(before), added: [], removed: [], status: "not applied", message: "Not reached (stopped)." };
    }
    if (readError) return { ...base, before: text(before), after: "unknown", status: "not verified", message: `Could not read it back: ${readError}` };
    const mismatch = mismatchBy.get(l.product.id);
    if (mismatch) return { ...base, before: text(before), after: "see message", status: "not verified", message: mismatch };
    return { ...base, before: text(before), after: text(after), status: "done", message: "" };
  });
  return { rows };
}

export function publishEngine(plan: PubPlan): RunEngine<PubLine> {
  return {
    lines: plan.lines,
    recheck: (lines) => recheckPublish(lines),
    run: (lines, hooks) => runPublish(plan, lines, hooks),
    describe: (l) => ({ productId: l.product.id, title: l.product.title, handle: l.product.handle }),
  };
}
