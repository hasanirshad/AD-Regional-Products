// Metafield types: how each type is entered, stored, compared and shown.
// Pure functions only (unit-tested in types.test.ts).
import { markupToRichText, normalizeRichText, richTextToMarkup } from "./richtext";

export type OwnerKind = "PRODUCT" | "PRODUCTVARIANT";

export type Element = string | number | Record<string, unknown>;

export type InputKind =
  | "text"
  | "multiline"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "url"
  | "color"
  | "json"
  | "richtext"
  | "dimension"
  | "weight"
  | "volume"
  | "money"
  | "rating"
  | "ref-product"
  | "ref-variant"
  | "ref-collection"
  | "ref-metaobject"
  | "unsupported";

export const DIMENSION_UNITS = ["mm", "cm", "m", "in", "ft", "yd"];
export const WEIGHT_UNITS = ["g", "kg", "oz", "lb"];
export const VOLUME_UNITS = ["ml", "cl", "l", "m3", "us_fl_oz", "us_pt", "us_qt", "us_gal", "imp_fl_oz", "imp_pt", "imp_qt", "imp_gal"];

export function isListType(type: string): boolean {
  return type.startsWith("list.");
}

export function baseType(type: string): string {
  return isListType(type) ? type.slice("list.".length) : type;
}

export function inputKindOf(type: string): InputKind {
  switch (baseType(type)) {
    case "single_line_text_field":
      return "text";
    case "multi_line_text_field":
      return "multiline";
    case "number_integer":
      return "integer";
    case "number_decimal":
      return "decimal";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "date_time":
      return "datetime";
    case "url":
      return "url";
    case "color":
      return "color";
    case "json":
      return "json";
    case "rich_text_field":
      return "richtext";
    case "dimension":
      return "dimension";
    case "weight":
      return "weight";
    case "volume":
      return "volume";
    case "money":
      return "money";
    case "rating":
      return "rating";
    case "product_reference":
      return "ref-product";
    case "variant_reference":
      return "ref-variant";
    case "collection_reference":
      return "ref-collection";
    case "metaobject_reference":
      return "ref-metaobject";
    default:
      return "unsupported";
  }
}

const BASE_LABELS: Record<string, string> = {
  single_line_text_field: "Single line text",
  multi_line_text_field: "Multi-line text",
  rich_text_field: "Rich text",
  number_integer: "Integer",
  number_decimal: "Decimal",
  boolean: "True or false",
  date: "Date",
  date_time: "Date and time",
  url: "URL",
  color: "Color",
  json: "JSON",
  dimension: "Dimension",
  weight: "Weight",
  volume: "Volume",
  money: "Money",
  rating: "Rating",
  product_reference: "Product",
  variant_reference: "Product variant",
  collection_reference: "Collection",
  metaobject_reference: "Metaobject entry",
  mixed_reference: "Mixed reference",
  file_reference: "File",
  page_reference: "Page",
  customer_reference: "Customer",
  company_reference: "Company",
  id: "ID",
  link: "Link",
  language: "Language",
  article_reference: "Article",
  product_taxonomy_value_reference: "Taxonomy value",
};

export function typeLabel(type: string): string {
  const base = baseType(type);
  const label = BASE_LABELS[base] ?? base.replace(/_/g, " ");
  return isListType(type) ? `List of ${label.toLowerCase()}` : label;
}

export function isSupportedType(type: string): boolean {
  const kind = inputKindOf(type);
  if (kind === "unsupported") return false;
  // These do not exist as lists in Shopify.
  if (isListType(type) && (kind === "boolean" || kind === "json" || kind === "richtext" || kind === "multiline")) return false;
  return true;
}

/** Plain-text types whose value can be translated by this app (single value only). */
export function canEditTranslations(type: string): boolean {
  if (isListType(type)) return false;
  const kind = inputKindOf(type);
  return kind === "text" || kind === "multiline";
}

const INLINE_KINDS: InputKind[] = ["text", "multiline", "integer", "decimal", "url", "color", "date", "datetime", "boolean"];

/** Single values that can be typed straight into a table cell (one text box or one choice). */
export function isInlineType(type: string): boolean {
  return !isListType(type) && isSupportedType(type) && INLINE_KINDS.includes(inputKindOf(type));
}

/**
 * Text typed into a cell  -> the stored value. Empty text means "no value" (null).
 * Only for isInlineType() types.
 */
export function inlineToStored(type: string, text: string): { value: string | null; error?: string } {
  const kind = inputKindOf(type);
  if (kind === "boolean") {
    const t = text.trim().toLowerCase();
    if (t === "") return { value: null };
    if (["true", "yes", "1"].includes(t)) return { value: "true" };
    if (["false", "no", "0"].includes(t)) return { value: "false" };
    return { value: null, error: `"${text.trim()}" is not true or false.` };
  }
  if (text.trim() === "") return { value: null };
  const built = buildElements(type, { ...emptyDraft(kind), text });
  if (built.error) return { value: null, error: built.error };
  return { value: encodeValue(type, built.elements) };
}

/** The text shown in a cell for a stored value. */
export function storedToInline(raw: string | null): string {
  return raw ?? "";
}

/** Which operations make sense for a type. */
export type Op = "set" | "add" | "remove" | "clear";

export function opsFor(type: string): Op[] {
  if (!isSupportedType(type)) return ["clear"];
  return isListType(type) ? ["add", "remove", "set", "clear"] : ["set", "clear"];
}

export function opLabel(op: Op, type: string): string {
  const list = isListType(type);
  switch (op) {
    case "set":
      return list ? "Replace the whole list with" : "Set the value to";
    case "add":
      return "Add to every list";
    case "remove":
      return "Remove from every list";
    case "clear":
      return list ? "Delete the metafield (empty the list)" : "Delete the metafield (clear the value)";
  }
}

export function needsValue(op: Op): boolean {
  return op !== "clear";
}

// ---------- Draft: what the person types or picks ----------

export interface PickedRef {
  id: string;
  label: string;
}

export interface Draft {
  text: string;
  unit: string;
  currency: string;
  ratingMin: string;
  ratingMax: string;
  bool: "true" | "false";
  refs: PickedRef[];
}

export function unitsFor(kind: InputKind): string[] {
  if (kind === "dimension") return DIMENSION_UNITS;
  if (kind === "weight") return WEIGHT_UNITS;
  if (kind === "volume") return VOLUME_UNITS;
  return [];
}

export function emptyDraft(kind: InputKind): Draft {
  return {
    text: "",
    unit: unitsFor(kind)[0] ?? "",
    currency: "USD",
    ratingMin: "1",
    ratingMax: "5",
    bool: "true",
    refs: [],
  };
}

export interface BuildResult {
  elements: Element[];
  error?: string;
}

function fail(error: string): BuildResult {
  return { elements: [], error };
}

const isNumberText = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

/** Turns the draft into elements for the type. One element for single types, one or more for lists. */
export function buildElements(type: string, draft: Draft): BuildResult {
  const kind = inputKindOf(type);
  const list = isListType(type);
  if (!isSupportedType(type)) return fail("This metafield type is not supported yet.");

  const lines = () =>
    draft.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  const many = (items: string[], check: (s: string) => string | null, make: (s: string) => Element): BuildResult => {
    if (items.length === 0) return fail(list ? "Enter at least one value (one per line)." : "Enter a value.");
    if (!list && items.length > 1) return fail("Enter only one value.");
    for (const item of items) {
      const problem = check(item);
      if (problem) return fail(problem);
    }
    return { elements: items.map(make) };
  };

  switch (kind) {
    case "text":
      return many(list ? lines() : [draft.text.trim()].filter(Boolean), () => null, (s) => s);
    case "multiline": {
      const text = draft.text.replace(/\s+$/, "");
      if (!text.trim()) return fail("Enter a value.");
      return { elements: [text] };
    }
    case "integer":
      return many(
        list ? lines() : [draft.text.trim()].filter(Boolean),
        (s) => (/^-?\d+$/.test(s) ? null : `"${s}" is not a whole number.`),
        (s) => (list ? Number(s) : String(Number(s))),
      );
    case "decimal":
      return many(
        list ? lines() : [draft.text.trim()].filter(Boolean),
        (s) => (isNumberText(s) ? null : `"${s}" is not a number.`),
        (s) => s,
      );
    case "boolean":
      return { elements: [draft.bool] };
    case "date":
      return many(
        list ? lines() : [draft.text.trim()].filter(Boolean),
        (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? null : `"${s}" is not a date (use YYYY-MM-DD).`),
        (s) => s,
      );
    case "datetime":
      return many(
        list ? lines() : [draft.text.trim()].filter(Boolean),
        (s) => (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s)) ? null : `"${s}" is not a date and time (use 2026-10-24T09:00:00Z).`),
        (s) => s,
      );
    case "url":
      return many(
        list ? lines() : [draft.text.trim()].filter(Boolean),
        (s) => (/^(https?:\/\/|mailto:|sms:|tel:)\S+$/i.test(s) ? null : `"${s}" is not a valid URL.`),
        (s) => s,
      );
    case "color":
      return many(
        list ? lines() : [draft.text.trim()].filter(Boolean),
        (s) => (/^#[0-9a-fA-F]{6}$/.test(s) ? null : `"${s}" is not a color (use #RRGGBB).`),
        (s) => s.toUpperCase(),
      );
    case "json": {
      const text = draft.text.trim();
      if (!text) return fail("Enter a value.");
      try {
        JSON.parse(text);
      } catch {
        return fail("This is not valid JSON.");
      }
      return { elements: [text] };
    }
    case "richtext": {
      if (!draft.text.trim()) return fail("Enter a value.");
      return { elements: [markupToRichText(draft.text)] };
    }
    case "dimension":
    case "weight":
    case "volume": {
      const text = draft.text.trim();
      if (!isNumberText(text)) return fail("Enter a number.");
      if (!unitsFor(kind).includes(draft.unit)) return fail("Choose a unit.");
      return { elements: [{ value: Number(text), unit: draft.unit }] };
    }
    case "money": {
      const text = draft.text.trim();
      if (!isNumberText(text)) return fail("Enter an amount.");
      const currency = draft.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return fail("Enter a 3-letter currency code, for example USD.");
      return { elements: [{ amount: text, currency_code: currency }] };
    }
    case "rating": {
      const text = draft.text.trim();
      const min = Number(draft.ratingMin);
      const max = Number(draft.ratingMax);
      if (!isNumberText(text)) return fail("Enter a rating.");
      if (Number(text) < min || Number(text) > max) return fail(`The rating must be between ${min} and ${max}.`);
      return { elements: [{ scale_min: min.toFixed(1), scale_max: max.toFixed(1), value: text }] };
    }
    case "ref-product":
    case "ref-variant":
    case "ref-collection":
    case "ref-metaobject": {
      if (draft.refs.length === 0) return fail(list ? "Pick at least one item." : "Pick an item.");
      if (!list && draft.refs.length > 1) return fail("Pick only one item.");
      return { elements: draft.refs.map((r) => r.id) };
    }
    default:
      return fail("This metafield type is not supported yet.");
  }
}

// ---------- Stored values ----------

export function elementToString(el: Element): string {
  if (typeof el === "string") return el;
  if (typeof el === "number") return String(el);
  return JSON.stringify(el);
}

/** The string Shopify stores for these elements. */
export function encodeValue(type: string, elements: Element[]): string {
  return isListType(type) ? JSON.stringify(elements) : elementToString(elements[0] ?? "");
}

/** Canonical key used to compare two elements. */
export function elementKey(kind: InputKind, el: unknown): string {
  const obj = (el ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "integer":
    case "decimal":
      return String(Number(el));
    case "dimension":
    case "weight":
    case "volume":
      return `${Number(obj.value)}|${String(obj.unit)}`;
    case "money":
      return `${Number(obj.amount)}|${String(obj.currency_code)}`;
    case "rating":
      return `${Number(obj.value)}|${Number(obj.scale_min)}|${Number(obj.scale_max)}`;
    case "json":
      try {
        return stableStringify(typeof el === "string" ? JSON.parse(el) : el);
      } catch {
        return String(el);
      }
    case "richtext":
      return stableStringify(normalizeRichText(typeof el === "string" ? safeParse(el) : el));
    default:
      return typeof el === "string" ? el : stableStringify(el);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Elements stored in a value. Lists give an array; single values give one element. Null when it cannot be read. */
export function parseValue(type: string, raw: string | null): Element[] | null {
  if (raw === null || raw === undefined) return [];
  const kind = inputKindOf(type);
  if (isListType(type)) {
    const parsed = safeParse(raw);
    return Array.isArray(parsed) ? (parsed as Element[]) : null;
  }
  if (kind === "dimension" || kind === "weight" || kind === "volume" || kind === "money" || kind === "rating" || kind === "richtext") {
    const parsed = safeParse(raw);
    return parsed && typeof parsed === "object" ? [parsed as Element] : null;
  }
  return [raw];
}

function keysOf(type: string, raw: string | null): string[] | null {
  const elements = parseValue(type, raw);
  if (elements === null) return null;
  const kind = inputKindOf(type);
  return elements.map((el) => elementKey(kind, el));
}

export function sameValue(type: string, a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const ka = keysOf(type, a);
  const kb = keysOf(type, b);
  if (ka === null || kb === null) return a === b;
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

function unique(kind: InputKind, elements: Element[]): Element[] {
  const seen = new Set<string>();
  const out: Element[] = [];
  for (const el of elements) {
    const key = elementKey(kind, el);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(el);
    }
  }
  return out;
}

export interface NextValue {
  /** null means the metafield is deleted. */
  next: string | null;
  changed: boolean;
  error?: string;
  note?: string;
}

/** What the stored value becomes after applying an operation. Pure. */
export function computeNext(type: string, current: string | null, op: Op, elements: Element[]): NextValue {
  const kind = inputKindOf(type);
  const list = isListType(type);

  if (op === "clear") return { next: null, changed: current !== null };

  if (!isSupportedType(type)) return { next: current, changed: false, error: "This metafield type is not supported yet." };
  if (elements.length === 0) return { next: current, changed: false, error: "No value to apply." };

  if (op === "set") {
    const next = encodeValue(type, list ? unique(kind, elements) : [elements[0] ?? ""]);
    return { next, changed: !sameValue(type, current, next) };
  }

  if (!list) return { next: current, changed: false, error: "Add and remove only work on list metafields." };

  const existing = parseValue(type, current);
  if (existing === null) return { next: current, changed: false, error: "The current value is not a readable list." };

  const existingKeys = new Set(existing.map((el) => elementKey(kind, el)));
  const targetKeys = new Set(elements.map((el) => elementKey(kind, el)));

  if (op === "add") {
    const toAdd = unique(
      kind,
      elements.filter((el) => !existingKeys.has(elementKey(kind, el))),
    );
    if (toAdd.length === 0) return { next: current, changed: false };
    return { next: JSON.stringify([...existing, ...toAdd]), changed: true };
  }

  // remove
  const kept = existing.filter((el) => !targetKeys.has(elementKey(kind, el)));
  if (kept.length === existing.length) return { next: current, changed: false };
  if (kept.length === 0) return { next: null, changed: true, note: "The list becomes empty, so the metafield is deleted." };
  return { next: JSON.stringify(kept), changed: true };
}

// ---------- Showing values ----------

export function shortGid(id: string): string {
  const match = /^gid:\/\/shopify\/([A-Za-z]+)\/(\d+)/.exec(id);
  return match ? `${match[1]} ${match[2]}` : id;
}

function richTextToPlain(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { value?: unknown; children?: unknown[] };
  if (typeof n.value === "string") return n.value;
  return (n.children ?? []).map(richTextToPlain).join(" ").trim();
}

export function formatElement(kind: InputKind, el: unknown, labels: Record<string, string> = {}): string {
  const obj = (el ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "boolean":
      return String(el) === "true" ? "Yes" : "No";
    case "dimension":
    case "weight":
    case "volume":
      return `${obj.value} ${obj.unit}`;
    case "money":
      return `${obj.amount} ${obj.currency_code}`;
    case "rating":
      return `${obj.value} / ${Number(obj.scale_max)}`;
    case "richtext":
      return richTextToPlain(typeof el === "string" ? safeParse(el) : el) || "—";
    case "ref-product":
    case "ref-variant":
    case "ref-collection":
    case "ref-metaobject":
      return labels[String(el)] ?? shortGid(String(el));
    default:
      return typeof el === "string" ? el : typeof el === "number" ? String(el) : JSON.stringify(el);
  }
}

/** One readable line for a table cell. */
export function formatValue(type: string, raw: string | null, labels: Record<string, string> = {}): string {
  if (raw === null || raw === undefined) return "—";
  const kind = inputKindOf(type);
  const elements = parseValue(type, raw);
  if (elements === null) return raw;
  if (elements.length === 0) return "—";
  return elements.map((el) => formatElement(kind, el, labels)).join(", ");
}

/** Reference ids inside a value (to look up their names). */
export function referenceIds(type: string, raw: string | null): string[] {
  const kind = inputKindOf(type);
  if (!kind.startsWith("ref-") || raw === null) return [];
  const elements = parseValue(type, raw);
  return (elements ?? []).map(String);
}

/** Fills a draft from a stored value so it can be edited. Lists of structured values start empty. */
export function draftFromValue(type: string, raw: string | null, labels: Record<string, string> = {}): Draft {
  const kind = inputKindOf(type);
  const draft = emptyDraft(kind);
  if (raw === null) return draft;
  const elements = parseValue(type, raw);
  if (elements === null) return { ...draft, text: raw };
  const first = elements[0];
  switch (kind) {
    case "boolean":
      return { ...draft, bool: String(first) === "true" ? "true" : "false" };
    case "dimension":
    case "weight":
    case "volume": {
      const o = (first ?? {}) as Record<string, unknown>;
      return elements.length === 1 ? { ...draft, text: String(o.value ?? ""), unit: String(o.unit ?? draft.unit) } : draft;
    }
    case "money": {
      const o = (first ?? {}) as Record<string, unknown>;
      return elements.length === 1 ? { ...draft, text: String(o.amount ?? ""), currency: String(o.currency_code ?? "USD") } : draft;
    }
    case "rating": {
      const o = (first ?? {}) as Record<string, unknown>;
      return elements.length === 1
        ? { ...draft, text: String(o.value ?? ""), ratingMin: String(Number(o.scale_min ?? 1)), ratingMax: String(Number(o.scale_max ?? 5)) }
        : draft;
    }
    case "richtext": {
      return { ...draft, text: richTextToMarkup(first).text };
    }
    case "ref-product":
    case "ref-variant":
    case "ref-collection":
    case "ref-metaobject":
      return { ...draft, refs: elements.map((el) => ({ id: String(el), label: labels[String(el)] ?? shortGid(String(el)) })) };
    default:
      return { ...draft, text: elements.map((el) => (typeof el === "string" ? el : String(el))).join("\n") };
  }
}

/** False when a rich text value has formatting the editor cannot keep exactly. Such a value is shown, never rewritten. */
export function richTextEditable(type: string, raw: string | null): boolean {
  if (inputKindOf(type) !== "richtext" || isListType(type) || raw === null) return true;
  return richTextToMarkup(raw).exact;
}
