// Bulk edit, the pure part: which columns exist, how a typed cell becomes a stored value (and back), filters, sorting,
// and reading a table pasted from a spreadsheet. Nothing here talks to Shopify (see bulkLoad.ts).
//
// A row is a product. A column is one target of that product: a product field, the price of its single variant, a
// product metafield, or the translation of a field in one language. Edits are the same pending edits the Edit product
// page uses (edits.ts), so the review, the checks and the apply code are shared.

import { dedupeTags, normText, parseNumber, tagsFromValue, tagsToValue } from "./canon";
import type { Definition } from "./load";
import { checkRules, type Validation } from "./mfRules";
import { formatValue, inlineToStored, isInlineType, storedToInline, typeLabel } from "./mfTypes";
import { PRODUCT_FIELD_LABEL, STATUS_LABEL, VARIANT_FIELD_LABEL, type ProductField, type Target, type Value, type VariantField, PRODUCT_TRANSLATION_KEY } from "./model";
import type { ProductRow } from "../types";

export type ColumnGroup = "Product" | "Prices" | "Metafields" | "Translations";
export type CellInput = "text" | "longtext" | "tags" | "status" | "price" | "metafield";

export type Column = {
  id: string;
  label: string;
  group: ColumnGroup;
  input: CellInput;
  editable: boolean;
  /** A short hint under the heading: why it is read only, or how to type it. */
  note?: string;
  /** product column, and the source field of a translation column */
  field?: ProductField;
  /** price column */
  variantField?: VariantField;
  /** metafield column */
  namespace?: string;
  key?: string;
  mfType?: string;
  validations?: Validation[];
  /** translation column */
  slot?: string;
};

const PRODUCT_INPUT: Record<string, CellInput> = {
  title: "text",
  descriptionHtml: "longtext",
  vendor: "text",
  productType: "text",
  status: "status",
  tags: "tags",
  seoTitle: "text",
  seoDescription: "text",
  handle: "text",
};

/** The product fields that can be edited in the table, in the order they are offered. */
export const PRODUCT_COLUMN_FIELDS: ProductField[] = ["title", "descriptionHtml", "vendor", "productType", "status", "tags", "seoTitle", "seoDescription", "handle"];

/** Fields that have a translation in each language. */
export const TRANSLATABLE_FIELDS: ProductField[] = ["title", "descriptionHtml", "seoTitle", "seoDescription", "handle", "productType"];

/** What "missing translation" looks at: the text a shopper would read. */
export const MISSING_FIELDS: ProductField[] = ["title", "descriptionHtml", "seoTitle", "seoDescription"];

export function productColumn(field: ProductField): Column {
  const input = PRODUCT_INPUT[field] ?? "text";
  return {
    id: `p:${field}`,
    label: PRODUCT_FIELD_LABEL[field],
    group: "Product",
    input,
    editable: true,
    field,
    ...(field === "tags" ? { note: "Separate tags with commas." } : {}),
    ...(field === "status" ? { note: "Active, draft or archived." } : {}),
    ...(field === "descriptionHtml" ? { note: "HTML, as Shopify stores it." } : {}),
  };
}

export function priceColumn(variantField: "price" | "compareAtPrice"): Column {
  return {
    id: `v:${variantField}`,
    label: VARIANT_FIELD_LABEL[variantField],
    group: "Prices",
    input: "price",
    editable: true,
    variantField,
    note: "Only for products with one variant. Others are edited on Edit product.",
  };
}

export function metafieldColumn(def: Pick<Definition, "namespace" | "key" | "name" | "type" | "validations">): Column {
  const editable = isInlineType(def.type);
  return {
    id: `m:${def.namespace}.${def.key}`,
    label: def.name,
    group: "Metafields",
    input: "metafield",
    editable,
    namespace: def.namespace,
    key: def.key,
    mfType: def.type,
    validations: def.validations,
    note: editable ? `${def.namespace}.${def.key} · ${typeLabel(def.type)}` : `${def.namespace}.${def.key} · ${typeLabel(def.type)}. Shown only: edit it on Edit product.`,
  };
}

export function translationColumn(field: ProductField, slot: string, slotLabel: string): Column {
  const input = PRODUCT_INPUT[field] ?? "text";
  return {
    id: `t:${slot}:${field}`,
    label: `${slotLabel} · ${PRODUCT_FIELD_LABEL[field]}`,
    group: "Translations",
    input: input === "longtext" ? "longtext" : "text",
    editable: PRODUCT_TRANSLATION_KEY[field] !== undefined,
    field,
    slot,
  };
}

/** The target a column edits on a product. Null when the column does not apply (a price on a product with several variants). */
export function targetOf(col: Column, productId: string, variantId: string | null): Target | null {
  if (col.group === "Product" && col.field) return { kind: "product", productId, field: col.field };
  if (col.group === "Prices" && col.variantField) return variantId ? { kind: "variant", productId, variantId, field: col.variantField } : null;
  if (col.group === "Metafields" && col.namespace && col.key && col.mfType) {
    return { kind: "metafield", productId, ownerId: productId, ownerKind: "PRODUCT", namespace: col.namespace, key: col.key, type: col.mfType };
  }
  if (col.group === "Translations" && col.field && col.slot) {
    const key = PRODUCT_TRANSLATION_KEY[col.field];
    if (!key) return null;
    return { kind: "translation", productId, resourceId: productId, resource: "product", field: key, slot: col.slot };
  }
  return null;
}

// ---------------------------------------------------------------- cells

/** A stored value as the text in a cell. */
export function cellText(col: Column, value: Value | undefined): string {
  const v = value ?? null;
  switch (col.input) {
    case "tags":
      return tagsFromValue(v).join(", ");
    case "status":
      return v ? (STATUS_LABEL[v] ?? v) : "";
    case "metafield":
      if (v === null) return "";
      return col.editable ? storedToInline(v) : formatValue(col.mfType ?? "", v);
    default:
      return v ?? "";
  }
}

/** "12,50", "€ 12.50", "1.250,00" -> "12.50", "12.50", "1250.00". Text that is not a number is returned unchanged. */
export function normalizePriceText(text: string): string {
  let t = text.trim().replace(/[\s ]/g, "").replace(/^(chf|eur|gbp|usd)/i, "").replace(/(chf|eur|gbp|usd)$/i, "").replace(/^[€£$]|[€£$]$/g, "");
  if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})*\.\d{1,2}$/.test(t)) t = t.replace(/,/g, "");
  else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  return t;
}

export type ParsedCell = { value: Value; error?: string };

const STATUS_WORDS: Record<string, string> = { active: "ACTIVE", draft: "DRAFT", archived: "ARCHIVED" };

/** Text typed into a cell -> the value wanted. An empty cell is "nothing" (null), which deletes a metafield or a translation. */
export function parseCell(col: Column, text: string): ParsedCell {
  if (!col.editable) return { value: null, error: "This column cannot be edited here." };
  switch (col.input) {
    case "tags": {
      const parts = text.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
      const bad = parts.find((t) => t.length > 255);
      if (bad) return { value: null, error: "A tag can be 255 characters at most." };
      return { value: tagsToValue(dedupeTags(parts)) };
    }
    case "status": {
      const t = text.trim().toLowerCase();
      const v = STATUS_WORDS[t];
      return v ? { value: v } : { value: null, error: `"${text.trim()}" is not a status. Use active, draft or archived.` };
    }
    case "price": {
      const t = normalizePriceText(text);
      if (t === "") return { value: null };
      return parseNumber(t) === null ? { value: t, error: `"${text.trim()}" is not a price. Use digits, for example 49.90.` } : { value: t };
    }
    case "metafield": {
      const built = inlineToStored(col.mfType ?? "", text);
      if (built.error) return { value: null, error: built.error };
      if (built.value === null) return { value: null };
      const broken = checkRules(col.mfType ?? "", col.validations ?? [], built.value);
      return broken ? { value: built.value, error: broken } : { value: built.value };
    }
    case "longtext":
      return { value: normText(text) === "" ? null : text.replace(/\r\n?/g, "\n").trim() };
    default: {
      const t = text.replace(/\r\n?/g, "\n").trim();
      return { value: t === "" ? null : t };
    }
  }
}

// ---------------------------------------------------------------- filters

export type BulkFilters = {
  search: string;
  status: string;
  vendor: string;
  productType: string;
  tag: string;
  /** A collection id, or "". */
  collection: string;
  /** A catalogue id (a market's catalogue), or "". */
  catalog: string;
  /** With a catalogue chosen: show the products that are in it ("in") or that are not ("not"). */
  catalogMode: "in" | "not";
  /** A language slot: show products with a missing translation in it. Judged on loaded products. */
  missingSlot: string;
  /** "namespace.key": show products where this product metafield is empty. Judged on loaded products. */
  emptyMetafield: string;
};

export const NO_BULK_FILTERS: BulkFilters = {
  search: "",
  status: "",
  vendor: "",
  productType: "",
  tag: "",
  collection: "",
  catalog: "",
  catalogMode: "in",
  missingSlot: "",
  emptyMetafield: "",
};

export const activeFilterCount = (f: BulkFilters): number =>
  [f.status, f.vendor, f.productType, f.tag, f.collection, f.catalog, f.missingSlot, f.emptyMetafield].filter(Boolean).length;

/** Filters that look at the product list only. Free, and applied to every product. */
export function applyListFilters(rows: ProductRow[], f: BulkFilters, collectionIds: Set<string> | null): ProductRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((p) => {
    if (q) {
      const hay = [p.title, p.handle, p.vendor, p.productType, ...p.tags].join("\n").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.status && p.status !== f.status) return false;
    if (f.vendor && p.vendor !== f.vendor) return false;
    if (f.productType && p.productType !== f.productType) return false;
    if (f.tag && !p.tags.includes(f.tag)) return false;
    if (f.collection && collectionIds && !collectionIds.has(p.id)) return false;
    if (f.catalog) {
      const inIt = p.catalogs.some((c) => c.id === f.catalog);
      if (f.catalogMode === "in" ? !inIt : inIt) return false;
    }
    return true;
  });
}

/** True when a filter needs values read from Shopify before it can judge a product. */
export const needsValues = (f: BulkFilters): boolean => Boolean(f.missingSlot || f.emptyMetafield);

/** The columns a filter needs read, besides the ones chosen for the table. */
export function filterColumns(f: BulkFilters, defs: Definition[]): Column[] {
  const out: Column[] = [];
  if (f.missingSlot) {
    for (const field of MISSING_FIELDS) out.push(productColumn(field), translationColumn(field, f.missingSlot, f.missingSlot));
  }
  if (f.emptyMetafield) {
    const def = defs.find((d) => `${d.namespace}.${d.key}` === f.emptyMetafield);
    if (def) out.push(metafieldColumn(def));
  }
  return out;
}

export type ValueLookup = (productId: string, target: Target) => Value | undefined;

/**
 * The filters that need values. A product whose values are not read yet is not judged: it is counted in `waiting`.
 * `valueOf` returns undefined for "not read".
 */
export function applyValueFilters(rows: ProductRow[], f: BulkFilters, defs: Definition[], valueOf: ValueLookup): { rows: ProductRow[]; waiting: number } {
  if (!needsValues(f)) return { rows, waiting: 0 };
  const def = f.emptyMetafield ? defs.find((d) => `${d.namespace}.${d.key}` === f.emptyMetafield) : undefined;
  let waiting = 0;
  const out: ProductRow[] = [];
  for (const p of rows) {
    let keep = true;
    let known = true;
    if (f.missingSlot) {
      let missing = false;
      for (const field of MISSING_FIELDS) {
        const key = PRODUCT_TRANSLATION_KEY[field]!;
        const source = valueOf(p.id, { kind: "product", productId: p.id, field });
        const tr = valueOf(p.id, { kind: "translation", productId: p.id, resourceId: p.id, resource: "product", field: key, slot: f.missingSlot });
        if (source === undefined || tr === undefined) {
          known = false;
          break;
        }
        if (normText(source) !== "" && normText(tr) === "") missing = true;
      }
      if (known && !missing) keep = false;
    }
    if (known && keep && f.emptyMetafield && def) {
      const v = valueOf(p.id, { kind: "metafield", productId: p.id, ownerId: p.id, ownerKind: "PRODUCT", namespace: def.namespace, key: def.key, type: def.type });
      if (v === undefined) known = false;
      else if (v !== null && v !== "") keep = false;
    }
    if (!known) waiting++;
    else if (keep) out.push(p);
  }
  return { rows: out, waiting };
}

// ---------------------------------------------------------------- sorting

export type Sort = { column: string; dir: "asc" | "desc" };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Sorts by what the cells show. Empty cells go last in both directions. Numbers are compared as numbers. */
export function sortRows<T>(rows: T[], sort: Sort | null, textOf: (row: T, column: string) => string): T[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  const keyed = rows.map((row, i) => ({ row, i, text: textOf(row, sort.column) }));
  keyed.sort((a, b) => {
    const ae = a.text.trim() === "";
    const be = b.text.trim() === "";
    if (ae || be) return ae === be ? a.i - b.i : ae ? 1 : -1;
    const an = parseNumber(a.text);
    const bn = parseNumber(b.text);
    const c = an !== null && bn !== null ? an - bn : collator.compare(a.text, b.text);
    return c !== 0 ? c * dir : a.i - b.i;
  });
  return keyed.map((k) => k.row);
}

/** The sort value of a product-list column, before any value has been read. */
export function listText(p: ProductRow, field: string): string | null {
  switch (field) {
    case "title":
      return p.title;
    case "vendor":
      return p.vendor;
    case "productType":
      return p.productType;
    case "status":
      return p.status;
    case "handle":
      return p.handle;
    case "tags":
      return p.tags.join(", ");
    default:
      return null;
  }
}

// ---------------------------------------------------------------- spreadsheet text

/** Tab-separated text (Excel, Google Sheets) -> rows of cells. Handles "quoted cells" with tabs, new lines and "" inside. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let started = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "" && !started) {
      quoted = true;
      started = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
      started = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      started = false;
    } else {
      cell += ch;
      started = true;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // A spreadsheet adds a blank line at the end.
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === "")) rows.pop();
  return rows;
}

/** Cells -> tab-separated text a spreadsheet pastes into columns. */
export function toTsv(rows: string[][]): string {
  const cell = (c: string) => (/[\t\n\r"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return rows.map((r) => r.map(cell).join("\t")).join("\n");
}

/** Typed in a pasted cell to empty the value. An empty pasted cell means "leave it as it is". */
export const CLEAR_WORD = "[clear]";

export type PasteEdit = { productId: string; column: Column; text: string };

export type PastePlan = {
  edits: PasteEdit[];
  /** The key the rows were matched on. */
  matchedBy: "handle" | "title" | "id" | null;
  /** Header cells that are no chosen column. */
  unknownColumns: string[];
  /** Header cells that are a column which cannot be edited here. */
  readOnlyColumns: string[];
  /** Key values that match no product. */
  unmatched: string[];
  /** Key values that match more than one product. */
  ambiguous: string[];
  /** A problem with the whole paste. */
  problem: string | null;
};

const KEY_HEADERS: Record<string, "handle" | "title" | "id"> = { handle: "handle", "url handle": "handle", id: "id", "product id": "id", title: "title" };

/**
 * Reads a pasted table. Row 1 is the header: the first column names the product (Handle, ID or Title), the other
 * headers are column labels. Rows are matched on that key; an empty cell leaves the value alone.
 */
export function planPaste(table: string[][], columns: Column[], products: ProductRow[]): PastePlan {
  const empty: PastePlan = { edits: [], matchedBy: null, unknownColumns: [], readOnlyColumns: [], unmatched: [], ambiguous: [], problem: null };
  if (table.length < 2) return { ...empty, problem: "Paste the header row and at least one product row." };
  const header = table[0]!.map((h) => h.trim());
  const matchedBy = KEY_HEADERS[(header[0] ?? "").toLowerCase()];
  if (!matchedBy) return { ...empty, problem: "The first column must be Handle, ID or Title, so each row can be matched to a product." };

  const byLabel = new Map<string, Column>();
  for (const c of columns) byLabel.set(c.label.trim().toLowerCase(), c);
  const colAt: (Column | null)[] = header.map((h, i) => (i === 0 ? null : (byLabel.get(h.toLowerCase()) ?? null)));
  const unknownColumns = header.slice(1).filter((h, i) => h !== "" && !colAt[i + 1]);
  const readOnlyColumns = colAt.filter((c): c is Column => c !== null && !c.editable).map((c) => c.label);
  if (colAt.every((c) => !c)) return { ...empty, matchedBy, unknownColumns, problem: "None of the headers match a column in the table. Choose the columns first, then paste." };

  const index = new Map<string, ProductRow[]>();
  for (const p of products) {
    const key = matchedBy === "handle" ? p.handle.toLowerCase() : matchedBy === "id" ? p.numericId : normText(p.title).toLowerCase();
    const list = index.get(key);
    if (list) list.push(p);
    else index.set(key, [p]);
  }

  const out: PasteEdit[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const seen = new Set<string>();
  for (const row of table.slice(1)) {
    const raw = (row[0] ?? "").trim();
    if (raw === "") continue;
    const key = matchedBy === "id" ? (/(\d+)$/.exec(raw)?.[1] ?? raw) : matchedBy === "title" ? normText(raw).toLowerCase() : raw.toLowerCase();
    const found = index.get(key);
    if (!found) {
      unmatched.push(raw);
      continue;
    }
    if (found.length > 1) {
      ambiguous.push(raw);
      continue;
    }
    const product = found[0]!;
    if (seen.has(product.id)) {
      ambiguous.push(`${raw} (listed twice)`);
      continue;
    }
    seen.add(product.id);
    row.forEach((text, i) => {
      const col = colAt[i];
      if (!col || !col.editable || i === 0) return;
      if (text.trim() === "") return;
      out.push({ productId: product.id, column: col, text: text.trim().toLowerCase() === CLEAR_WORD ? "" : text });
    });
  }
  return { edits: out, matchedBy, unknownColumns, readOnlyColumns, unmatched, ambiguous, problem: out.length === 0 && unmatched.length + ambiguous.length === 0 ? "The pasted cells are all empty, so nothing would change." : null };
}

/** The table as text a spreadsheet can edit and paste back: a header row, the key column first. */
export function tableToTsv(columns: Column[], rows: ProductRow[], cellOf: (row: ProductRow, col: Column) => string): string {
  const head = ["Handle", ...columns.map((c) => c.label)];
  return toTsv([head, ...rows.map((r) => [r.handle, ...columns.map((c) => cellOf(r, c))])]);
}
