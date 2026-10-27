// Pending edits: what the person has typed but not saved. One entry per target, holding the END STATE wanted.
// An entry that returns a field to its saved value disappears, so "Changes" only ever lists real differences.
// Pure.

import { sameFor } from "./canon";
import type { Draft } from "./mfTypes";
import { tabOf, targetKey, type TabId, type Target, type Value } from "./model";

export type PendingEdit = {
  target: Target;
  /** The value wanted. For a metafield with a problem this is the last valid value, not used. */
  value: Value;
  /** The boxes on screen (metafields). Kept so a half-typed, invalid value is not lost while editing. */
  draft?: Draft[];
  /** A problem with what was typed. While any edit has one, the review is blocked. */
  error?: string | null;
};

export type EditMap = Record<string, PendingEdit>;

/**
 * Sets the wanted value of a target. `base` is the saved value.
 * Returns the same map when nothing changes, so React can skip a redraw.
 */
export function putEdit(edits: EditMap, target: Target, value: Value, base: Value, extra: { draft?: Draft[]; error?: string | null } = {}): EditMap {
  const key = targetKey(target);
  const error = extra.error ?? null;
  if (!error && sameFor(target, value, base)) {
    if (!(key in edits)) return edits;
    const { [key]: _gone, ...rest } = edits;
    return rest;
  }
  const entry: PendingEdit = { target, value, ...(extra.draft ? { draft: extra.draft } : {}), ...(error ? { error } : {}) };
  return { ...edits, [key]: entry };
}

export function removeEdits(edits: EditMap, keys: string[]): EditMap {
  if (keys.length === 0) return edits;
  const drop = new Set(keys);
  return Object.fromEntries(Object.entries(edits).filter(([k]) => !drop.has(k)));
}

export const editCount = (edits: EditMap): number => Object.keys(edits).length;

export function countByTab(edits: EditMap): Record<TabId, number> {
  const out: Record<TabId, number> = { basic: 0, seo: 0, productMeta: 0, variantMeta: 0, type: 0, inventory: 0, tags: 0, prices: 0 };
  for (const e of Object.values(edits)) out[tabOf(e.target)]++;
  return out;
}

export const errorEdits = (edits: EditMap): PendingEdit[] => Object.values(edits).filter((e) => e.error);

/** Edits of one product. */
export function editsOfProduct(edits: EditMap, productId: string): EditMap {
  return Object.fromEntries(Object.entries(edits).filter(([, e]) => e.target.productId === productId));
}

/** The value a target has right now on screen: the pending one, or the saved one. */
export function effective(edits: EditMap, target: Target, base: Value): Value {
  const e = edits[targetKey(target)];
  return e ? e.value : base;
}
