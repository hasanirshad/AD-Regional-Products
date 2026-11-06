// The search box: one text for every row, made of all its columns plus the fields that identify it. Several words must
// ALL be found, in any column, case-insensitive. Pure.

import type { ProductRow } from "../types";

const cache = new WeakMap<ProductRow, string>();

/** The text of the fields that identify a product, lower-case. */
export function identityText(p: ProductRow): string {
  let text = cache.get(p);
  if (text === undefined) {
    text = [p.title, p.handle, p.id, p.numericId, p.vendor, p.productType, p.status, ...p.tags, ...p.catalogs.map((c) => c.title)].join("\n").toLowerCase();
    cache.set(p, text);
  }
  return text;
}

/** The words of a search, lower-case, without blanks. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The searchable text of a row: what identifies it, plus the text of the columns the table shows
 * (`columns`: the page passes the cell texts, or SKU and other hidden fields it knows).
 */
export function rowText(p: ProductRow, columns: readonly string[] = []): string {
  const base = identityText(p);
  return columns.length === 0 ? base : `${base}\n${columns.join("\n").toLowerCase()}`;
}

/** True when every word is found in the text. An empty search matches everything. */
export function matchesWords(text: string, words: readonly string[]): boolean {
  for (const w of words) if (!text.includes(w)) return false;
  return true;
}

export const matchesSearch = (p: ProductRow, query: string, columns: readonly string[] = []): boolean => {
  const words = searchWords(query);
  return words.length === 0 || matchesWords(rowText(p, columns), words);
};
