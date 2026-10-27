// The run engine for the editor: recheck before writing, apply with a few products at once, read every change back,
// and report one row per change. Plugs into the shared RunFlow screen (confirm box, password, first-product trial, CSV).

import type { Progress } from "../applyMove";
import type { RunEngine, RunHooks } from "../engine";
import type { Finding } from "../readback";
import type { ReportRow } from "../report";
import { applyBundle, DEFAULT_OPTIONS, type ApplyOptions, type ChangeOutcome } from "./apply";
import { diffTags, sameFor, showValue, tagsFromValue } from "./canon";
import type { Gql } from "./gql";
import { messageOf } from "./gql";
import type { Bundle, Change, Value } from "./model";
import { runPool } from "./pool";
import { readValues } from "./read";

/** Products written at the same time. Shopify's cost bucket still applies: the client slows down when it runs low. */
export const LANES = 3;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reads the targets again. Differences from the review are findings; nothing is written. */
export async function recheckBundles(gql: Gql, bundles: Bundle[]): Promise<Finding[]> {
  const targets = bundles.flatMap((b) => b.changes.map((c) => c.target));
  const now = await readValues(gql, targets);
  const out: Finding[] = [];
  for (const b of bundles) {
    const problems: string[] = [];
    for (const c of b.changes) {
      const actual = now.get(c.id);
      if (actual === undefined) {
        problems.push(`${c.label}: no longer found in Shopify.`);
      } else if (!sameFor(c.target, actual, c.before)) {
        problems.push(`${c.label}: changed in Shopify (now ${quote(c, actual)}, the review expected ${quote(c, c.before)}).`);
      }
    }
    if (problems.length > 0) {
      const shown = problems.slice(0, 3).join(" ");
      out.push({ productId: b.productId, title: b.title, message: problems.length > 3 ? `${shown} And ${problems.length - 3} more.` : shown });
    }
  }
  return out;
}

const quote = (c: Change, v: Value): string => {
  const text = showValue(c.target, v);
  return text.length > 60 ? `“${text.slice(0, 57)}…”` : `“${text}”`;
};

export type RunSummary = {
  rows: ReportRow[];
  /** Changes Shopify accepted (done, or not confirmed on read-back). These are the ones Undo can reverse. */
  applied: Change[];
};

function rowFor(b: Bundle, c: Change, status: ReportRow["status"], message: string, afterShown?: string): ReportRow {
  const tags = c.target.kind === "product" && c.target.field === "tags" ? diffTags(tagsFromValue(c.before), tagsFromValue(c.after)) : { added: [], removed: [] };
  return {
    productId: b.productId,
    title: `${b.title} · ${c.label}`,
    handle: b.handle,
    before: showValue(c.target, c.before),
    after: afterShown ?? showValue(c.target, c.after),
    added: tags.added,
    removed: tags.removed,
    status,
    message,
  };
}

/** Applies the bundles, reads the changes back, and returns one report row per change. */
export async function runBundles(gql: Gql, bundles: Bundle[], hooks: RunHooks, options: ApplyOptions = DEFAULT_OPTIONS): Promise<RunSummary> {
  hooks.onStage?.("applying");
  const outcomes = new Map<string, Map<string, ChangeOutcome>>();
  let done = 0;
  const progress = (): Progress => ({ phase: "editing", done, total: bundles.length });
  hooks.onProgress(progress());

  await runPool(bundles, LANES, async (b) => {
    if (hooks.shouldStop()) return;
    try {
      outcomes.set(b.productId, await applyBundle(gql, b, options));
    } catch (e) {
      outcomes.set(b.productId, new Map(b.changes.map((c) => [c.id, { status: "failed" as const, message: messageOf(e) }])));
    }
    done++;
    hooks.onProgress(progress());
  });

  // Read back what Shopify accepted.
  hooks.onStage?.("verifying");
  const accepted = bundles.flatMap((b) => b.changes.filter((c) => outcomes.get(b.productId)?.get(c.id)?.status === "done"));
  let shown = new Map<string, Value>();
  let readError = "";
  let wrong = new Set<string>();
  const check = async (changes: Change[]) => {
    shown = new Map([...shown, ...(await readValues(gql, changes.map((c) => c.target)))]);
    return new Set(changes.filter((c) => !sameFor(c.target, shown.get(c.id), c.after)).map((c) => c.id));
  };
  try {
    wrong = await check(accepted);
    if (wrong.size > 0) {
      await wait(hooks.retryWaitMs ?? 1500);
      wrong = await check(accepted.filter((c) => wrong.has(c.id)));
    }
  } catch (e) {
    readError = messageOf(e);
  }

  const rows: ReportRow[] = [];
  const applied: Change[] = [];
  for (const b of bundles) {
    const mine = outcomes.get(b.productId);
    for (const c of b.changes) {
      const o = mine?.get(c.id);
      if (!o) {
        rows.push(rowFor(b, c, "not applied", "Not reached (stopped)."));
      } else if (o.status === "failed") {
        rows.push(rowFor(b, c, "failed", o.message));
      } else if (o.status === "not applied") {
        rows.push(rowFor(b, c, "not applied", o.message));
      } else if (readError) {
        applied.push(c);
        rows.push(rowFor(b, c, "not verified", `Could not read it back: ${readError}`, "unknown"));
      } else if (wrong.has(c.id)) {
        applied.push(c);
        rows.push(rowFor(b, c, "not verified", "Shopify said ok but still shows a different value.", showValue(c.target, shown.get(c.id))));
      } else {
        applied.push(c);
        rows.push(rowFor(b, c, "done", ""));
      }
    }
  }
  return { rows, applied };
}

/**
 * The engine RunFlow runs. `afterRun` is called with the summary while the password is still active, so the Undo record
 * can be saved in Shopify as part of the same confirmed run. A failure there never fails the run.
 */
export function editorEngine(input: {
  gql: Gql;
  bundles: Bundle[];
  options?: ApplyOptions;
  afterRun?: (summary: RunSummary) => Promise<void> | void;
}): RunEngine<Bundle> {
  const options = input.options ?? DEFAULT_OPTIONS;
  return {
    lines: input.bundles,
    recheck: (lines) => recheckBundles(input.gql, lines),
    run: async (lines, hooks) => {
      const summary = await runBundles(input.gql, lines, hooks, options);
      try {
        await input.afterRun?.(summary);
      } catch {
        // Saving the Undo record is best effort.
      }
      return { rows: summary.rows };
    },
    describe: (b) => ({ productId: b.productId, title: b.title, handle: b.handle }),
  };
}
