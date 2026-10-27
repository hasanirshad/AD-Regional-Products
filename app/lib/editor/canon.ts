// Comparing and showing values. Two values are "the same" when Shopify would treat them the same, so a cosmetic
// difference (extra spaces, 10 vs 10.00, tag case, handle capitals) is never shown as a change, and never makes a
// read-back look like a failure. Pure.

import { formatValue, sameValue as sameMetafieldValue, typeLabel } from "./mfTypes";
import { STATUS_LABEL, type ProductField, type Target, type Value, type VariantField } from "./model";

// ---------- Text ----------

/** Line endings made equal, outer blank space removed. Empty text and null are the same thing: nothing. */
export function normText(v: Value | undefined): string {
  return (v ?? "").replace(/\r\n?/g, "\n").trim();
}

/** What Shopify turns a typed handle into: lower case, letters and digits joined by single dashes. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------- Numbers (prices, quantities) ----------

/** "12.5" -> 12.5; null for blank or not a number. */
export function parseNumber(v: Value | undefined): number | null {
  const t = (v ?? "").trim();
  if (t === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Two decimals, the way Shopify stores a price. */
export function formatPrice(v: Value | undefined): string {
  const n = parseNumber(v);
  return n === null ? "" : n.toFixed(2);
}

// ---------- Tags ----------

/** Tags are stored in a value as a JSON list. */
export function tagsToValue(tags: string[]): Value {
  const clean = dedupeTags(tags);
  return clean.length === 0 ? null : JSON.stringify(clean);
}

export function tagsFromValue(v: Value | undefined): string[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Tags are not case sensitive in Shopify: "Sofa" and "sofa" are one tag. The first spelling wins. */
export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function diffTags(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before.map((t) => t.toLowerCase()));
  const a = new Set(after.map((t) => t.toLowerCase()));
  return {
    added: after.filter((t) => !b.has(t.toLowerCase())),
    removed: before.filter((t) => !a.has(t.toLowerCase())),
  };
}

// ---------- Same value? ----------

export function sameFor(target: Target, a: Value | undefined, b: Value | undefined): boolean {
  switch (target.kind) {
    case "product":
      return sameProductField(target.field, a, b);
    case "variant":
      return sameVariantField(target.field, a, b);
    case "metafield": {
      const x = a ?? null;
      const y = b ?? null;
      if (x === null || y === null) return x === y;
      return sameMetafieldValue(target.type, x, y);
    }
    case "stock":
      return parseNumber(a) === parseNumber(b);
    case "translation":
      return normText(a) === normText(b);
  }
}

function sameProductField(field: ProductField, a: Value | undefined, b: Value | undefined): boolean {
  if (field === "tags") {
    const x = tagsFromValue(a).map((t) => t.toLowerCase()).sort();
    const y = tagsFromValue(b).map((t) => t.toLowerCase()).sort();
    return x.length === y.length && x.every((t, i) => t === y[i]);
  }
  if (field === "handle") return slugify(normText(a)) === slugify(normText(b));
  return normText(a) === normText(b);
}

function sameVariantField(field: VariantField, a: Value | undefined, b: Value | undefined): boolean {
  if (field === "price" || field === "compareAtPrice") {
    const x = parseNumber(a);
    const y = parseNumber(b);
    // A blank compare-at price and "0.00" both mean "no compare-at price".
    const nothing = (n: number | null) => n === null || (field === "compareAtPrice" && n === 0);
    if (nothing(x) || nothing(y)) return nothing(x) && nothing(y);
    return x === y;
  }
  return normText(a) === normText(b);
}

// ---------- Showing values ----------

const POLICY_LABEL: Record<string, string> = { DENY: "Stop selling", CONTINUE: "Keep selling" };

/** A value as plain text for the review and the report. Empty values show as an em dash. */
export function showValue(target: Target, v: Value | undefined): string {
  const empty = "—";
  switch (target.kind) {
    case "product":
      if (target.field === "status") return v ? (STATUS_LABEL[v] ?? v) : empty;
      if (target.field === "tags") {
        const tags = tagsFromValue(v);
        return tags.length ? tags.join(", ") : empty;
      }
      if (target.field === "category") return v ? categoryLabel(v) : empty;
      return normText(v) === "" ? empty : (v as string);
    case "variant":
      if (target.field === "tracked") return v === "true" ? "Yes" : v === "false" ? "No" : empty;
      if (target.field === "policy") return v ? (POLICY_LABEL[v] ?? v) : empty;
      return normText(v) === "" ? empty : (v as string);
    case "metafield":
      return v === null || v === undefined ? empty : formatValue(target.type, v);
    case "stock":
      return v === null || v === undefined || v === "" ? empty : v;
    case "translation":
      return normText(v) === "" ? empty : (v as string);
  }
}

const CATEGORY_NAMES = new Map<string, string>();

/** Remembers a category's name (from the product read or the picker) so values can be shown by name. */
export function rememberCategory(id: string, name: string): void {
  if (id && name) CATEGORY_NAMES.set(id, name);
}

/** A category is stored as its id. The name comes from what was read or picked; without it only the last part of the id shows. */
export function categoryLabel(v: string): string {
  return CATEGORY_NAMES.get(v) ?? v.split("/").pop() ?? v;
}

export const typeName = typeLabel;

// ---------- Translation status ----------

export type TranslationStatus = "translated" | "missing" | "same" | "outdated" | "no-source";

export const STATUS_WORDS: Record<TranslationStatus, string> = {
  translated: "Translated",
  missing: "Missing",
  same: "Same as source",
  outdated: "Outdated",
  "no-source": "No source text",
};

export const STATUS_TONE: Record<TranslationStatus, "success" | "critical" | "warning" | "info" | "neutral"> = {
  translated: "success",
  missing: "critical",
  same: "info",
  outdated: "warning",
  "no-source": "neutral",
};

/**
 * The state of one language box.
 * `source` is the text of the primary language (as it will be after saving), `translation` the text in the box.
 * `outdated` is Shopify's flag, or true when the source is being changed so the saved translation will be outdated.
 */
export function translationStatus(source: Value | undefined, translation: Value | undefined, outdated: boolean): TranslationStatus {
  if (normText(source) === "") return "no-source";
  if (normText(translation) === "") return "missing";
  if (outdated) return "outdated";
  if (normText(translation) === normText(source)) return "same";
  return "translated";
}
