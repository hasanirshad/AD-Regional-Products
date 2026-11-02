// The "Inventory & prices" step: stock or made to order, the default location, and the CAP (compare-at price) that
// the sale price follows. Pure: each helper returns the edits to put, as end values, and notes to show the person.

import { normText, parseNumber } from "./canon";
import type { VariantDoc } from "./doc";
import type { Target, Value } from "./model";

export const DEFAULT_LOCATION_NAME = "Hardman Möbel Ltd. | London";

export type StockMode = "stock" | "made_to_order";
export type PlannedEdit = { target: Target; value: Value };

/** Lower case, no accents, single spaces: "Hardman Möbel Ltd. | London" and "hardman mobel ltd | london" are the same name. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, " ")
    .replace(/\s*\|\s*/g, " | ")
    .trim();
}

/**
 * The location a new product is stocked at by default: the exact name, or else the only location with "London" in its
 * name. Never a guess beyond that; null means the person has to choose.
 */
export function defaultLocation(locations: { id: string; name: string }[]): { id: string; name: string } | null {
  const want = fold(DEFAULT_LOCATION_NAME);
  const exact = locations.find((l) => fold(l.name) === want);
  if (exact) return exact;
  const london = locations.filter((l) => fold(l.name).includes("london"));
  return london.length === 1 ? london[0]! : null;
}

/** Stock when every variant is tracked, made to order when none is, otherwise mixed. */
export function modeOf(variants: { tracked: boolean }[]): StockMode | "mixed" {
  if (variants.length === 0) return "made_to_order";
  const n = variants.filter((v) => v.tracked).length;
  return n === variants.length ? "stock" : n === 0 ? "made_to_order" : "mixed";
}

const stockTarget = (productId: string, v: VariantDoc, locationId: string): Target => ({ kind: "stock", productId, variantId: v.id, itemId: v.itemId, locationId });
export const trackedTarget = (productId: string, v: VariantDoc): Target => ({ kind: "variant", productId, variantId: v.id, field: "tracked" });
export const stockTargetOf = stockTarget;

/**
 * Switches a product between stock and made to order.
 *   made to order: inventory is not tracked. A variant with no location yet gets the default one (quantity 0).
 *   stock:         inventory is tracked. A variant that holds no units gets 1 at its main location (the default location
 *                  if it has one, else its first). Quantities already there are kept.
 * Existing locations are never removed by a switch.
 */
export function planStockMode(productId: string, variants: VariantDoc[], mode: StockMode, defaultLocationId: string | null): { edits: PlannedEdit[]; notes: string[] } {
  const edits: PlannedEdit[] = [];
  const notes: string[] = [];
  let needLocation = false;
  for (const v of variants) {
    edits.push({ target: trackedTarget(productId, v), value: mode === "stock" ? "true" : "false" });
    if (v.levels.length === 0) {
      if (!defaultLocationId) {
        needLocation = true;
        continue;
      }
      edits.push({ target: stockTarget(productId, v, defaultLocationId), value: mode === "stock" ? "1" : "0" });
      continue;
    }
    if (mode === "stock" && v.levels.every((l) => l.quantity <= 0)) {
      const main = v.levels.find((l) => l.locationId === defaultLocationId) ?? v.levels[0]!;
      edits.push({ target: stockTarget(productId, v, main.locationId), value: "1" });
    }
  }
  if (needLocation) notes.push(`Choose a location for the variants. "${DEFAULT_LOCATION_NAME}" was not found in this store.`);
  return { edits, notes };
}

/** True when the variant is on sale: a compare-at price above the price. */
export function saleRunning(v: { price: string; compareAtPrice: string | null }): boolean {
  const price = parseNumber(v.price);
  const compare = parseNumber(v.compareAtPrice);
  return price !== null && compare !== null && compare > price;
}

/** A typed CAP as the value to save: a number as text, or null when empty. null with `bad` when it is not a price. */
export function capValue(text: string): { value: Value; bad: boolean } {
  const t = normText(text).replace(",", ".");
  if (t === "") return { value: null, bad: false };
  const n = parseNumber(t);
  if (n === null || n < 0) return { value: null, bad: true };
  return { value: n.toFixed(2), bad: false };
}

/**
 * The person types the CAP only; the price follows it. If a sale is already running on a saved variant (its price is
 * below its CAP) the price is left alone, with a note, so a real sale price is never overwritten by accident.
 */
export function planCap(productId: string, v: VariantDoc, text: string): { edits: PlannedEdit[]; note: string | null; bad: boolean } {
  const cap = capValue(text);
  if (cap.bad) return { edits: [], note: null, bad: true };
  const edits: PlannedEdit[] = [{ target: { kind: "variant", productId, variantId: v.id, field: "compareAtPrice" }, value: cap.value }];
  if (cap.value === null) return { edits, note: null, bad: false };
  if (saleRunning(v)) return { edits, note: `A sale is running on this variant (price ${v.price}). The sale price was left as it is.`, bad: false };
  edits.push({ target: { kind: "variant", productId, variantId: v.id, field: "price" }, value: cap.value });
  return { edits, note: null, bad: false };
}

/** The same CAP for every variant (a "copy to all" helper). */
export function planCapForAll(productId: string, variants: VariantDoc[], text: string): { edits: PlannedEdit[]; notes: string[]; bad: boolean } {
  const edits: PlannedEdit[] = [];
  const notes: string[] = [];
  for (const v of variants) {
    const p = planCap(productId, v, text);
    if (p.bad) return { edits: [], notes: [], bad: true };
    edits.push(...p.edits);
    if (p.note) notes.push(p.note);
  }
  return { edits, notes, bad: false };
}
