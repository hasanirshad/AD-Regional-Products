// Bulk edit, Variants mode: one row per VARIANT of the products you chose. The columns are variant fields (price,
// compare-at price, SKU, barcode), variant metafields, and the translation of a variant metafield into each language
// (and each market adaptation) of the store. Edits are the same pending edits as everywhere else (edits.ts), so the
// review, the password, the recheck, the read-back and Undo are the shared ones.
//
// Pure functions, plus the reads (reads are free). Nothing here writes.

import { cellText, metafieldColumn, parseCell, variantColumn, type Column } from "./bulk";
import { chunks, type Gql } from "./gql";
import { buildVariantMetafieldsQuery, loadTranslations } from "./load";
import { inputKindOf, isInlineType, isListType } from "./mfTypes";
import { translatableMetafield } from "./mfModel";
import { targetKey, type Target, type Value, type VariantField } from "./model";
import { mfKey } from "./doc";
import type { Definition } from "./load";
import type { Slot } from "./locales";

/** Products that can be chosen at once, and variants read for each. */
export const MAX_PRODUCTS = 200;
export const MAX_VARIANTS = 250;
const VARIANT_PAGE = 100;
/** Products read together: 3 x 100 variants stays under Shopify's cost limit. */
const PRODUCTS_PER_READ = 3;

export type VariantRow = {
  id: string;
  productId: string;
  productTitle: string;
  productHandle: string;
  /** "Oak / 180", or "Default Title" for a product without options. */
  title: string;
  position: number;
};

/** Variant fields offered as columns. */
export const VARIANT_FIELDS: VariantField[] = ["price", "compareAtPrice", "sku", "barcode"];

export const variantFieldColumn = (f: (typeof VARIANT_FIELDS)[number]): Column => {
  const { note: _note, ...rest } = variantColumn(f as "price");
  return rest;
};

/** A variant metafield as a column. */
export function variantMetaColumn(def: Pick<Definition, "namespace" | "key" | "name" | "type" | "validations">): Column {
  const c = metafieldColumn(def);
  return { ...c, id: `vm:${def.namespace}.${def.key}` };
}

/** Translation of a variant metafield: text, multi-line text and links, single values only (the same rule as Edit product). */
export const translatableVariantMetafield = (type: string): boolean => !isListType(type) && translatableMetafield(type) && ["text", "multiline", "url"].includes(inputKindOf(type));

export function variantTranslationColumn(def: Pick<Definition, "namespace" | "key" | "name" | "type">, slot: string, slotLabel: string): Column {
  return {
    id: `vt:${slot}:${def.namespace}.${def.key}`,
    label: `${slotLabel} · ${def.name}`,
    group: "Translations",
    input: inputKindOf(def.type) === "multiline" ? "longtext" : "text",
    editable: true,
    namespace: def.namespace,
    key: def.key,
    mfType: def.type,
    slot,
    note: "The value must be saved first; the translation belongs to the saved metafield.",
  };
}

/** True for the columns that edit a variant metafield. */
export const isMetaColumn = (c: Column): boolean => c.group === "Metafields";
export const isTranslationColumn = (c: Column): boolean => c.group === "Translations";

/** Everything a variant table reads: the values by target key, the id of each variant metafield, and the cells asked for. */
export type VariantCache = {
  /** product id -> its variants (empty = none or the product is gone). */
  rows: Map<string, VariantRow[]>;
  /** product ids with more variants than MAX_VARIANTS (only the first are shown). */
  truncated: Set<string>;
  values: Map<string, Value>;
  /** "variantId|namespace.key" -> the id of the metafield (it exists only once it has a value). */
  metafieldIds: Map<string, string>;
  /** "variantId|columnId" for every cell that was asked for. */
  fetched: Set<string>;
};

export const newVariantCache = (): VariantCache => ({ rows: new Map(), truncated: new Set(), values: new Map(), metafieldIds: new Map(), fetched: new Set() });

/** The target a column edits on a variant. Null when it does not apply (a translation of a metafield that has no value yet). */
export function variantTargetOf(col: Column, row: VariantRow, cache: Pick<VariantCache, "metafieldIds">): Target | null {
  if (col.group === "Variant" && col.variantField) return { kind: "variant", productId: row.productId, variantId: row.id, field: col.variantField };
  if (col.group === "Metafields" && col.namespace && col.key && col.mfType) {
    return { kind: "metafield", productId: row.productId, ownerId: row.id, ownerKind: "PRODUCTVARIANT", namespace: col.namespace, key: col.key, type: col.mfType };
  }
  if (col.group === "Translations" && col.namespace && col.key && col.slot) {
    const resourceId = cache.metafieldIds.get(`${row.id}|${mfKey(col.namespace, col.key)}`);
    return resourceId ? { kind: "translation", productId: row.productId, resourceId, resource: "metafield", field: "value", slot: col.slot, mfType: col.mfType } : null;
  }
  return null;
}

/** Why a cell cannot be typed in, or null when it can. */
export function cellBlocker(col: Column, row: VariantRow, cache: Pick<VariantCache, "metafieldIds" | "values">): string | null {
  if (!col.editable) return "Shown only";
  if (col.group === "Translations" && col.namespace && col.key) {
    const id = cache.metafieldIds.get(`${row.id}|${mfKey(col.namespace, col.key)}`);
    if (!id) return "Save the value first";
  }
  return null;
}

// ---------------------------------------------------------------- reading

const VARIANT_SELECTION = `id title position price compareAtPrice barcode inventoryPolicy inventoryItem { tracked sku }`;

const ROWS_QUERY = `#graphql
  query BulkVariantRows($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id title handle
        variants(first: ${VARIANT_PAGE}) {
          pageInfo { hasNextPage endCursor }
          nodes { ${VARIANT_SELECTION} }
        }
      }
    }
  }`;

const ROWS_MORE_QUERY = `#graphql
  query BulkVariantRowsMore($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: ${VARIANT_PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${VARIANT_SELECTION} }
      }
    }
  }`;

type RawVariant = {
  id: string;
  title: string;
  position: number;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  inventoryPolicy: string;
  inventoryItem: { tracked: boolean; sku: string | null } | null;
};
type RawPage = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawVariant[] };

/** Fills the cache with the variants of these products and their plain fields. A product that is gone gets no rows. */
export async function loadVariantRows(gql: Gql, productIds: string[], cache: VariantCache, hooks: { shouldStop?: () => boolean } = {}): Promise<void> {
  const todo = productIds.filter((id) => !cache.rows.has(id));
  for (const group of chunks(todo, PRODUCTS_PER_READ)) {
    if (hooks.shouldStop?.()) return;
    const data = await gql<{ nodes: ({ id: string; title: string; handle: string; variants: RawPage } | null)[] }>(ROWS_QUERY, { ids: group });
    const seen = new Set<string>();
    for (const p of data.nodes) {
      if (!p?.id) continue;
      seen.add(p.id);
      let nodes = [...p.variants.nodes];
      let more = p.variants.pageInfo;
      for (let page = 0; more.hasNextPage && nodes.length < MAX_VARIANTS && page < 3; page++) {
        const next: { product: { variants: RawPage } | null } = await gql(ROWS_MORE_QUERY, { id: p.id, after: more.endCursor });
        if (!next.product) break;
        nodes.push(...next.product.variants.nodes);
        more = next.product.variants.pageInfo;
      }
      if (nodes.length > MAX_VARIANTS || more.hasNextPage) cache.truncated.add(p.id);
      nodes = nodes.slice(0, MAX_VARIANTS);
      cache.rows.set(
        p.id,
        nodes.map((v) => ({ id: v.id, productId: p.id, productTitle: p.title, productHandle: p.handle, title: v.title, position: v.position })),
      );
      for (const v of nodes) putFieldValues(cache, p.id, v);
    }
    for (const id of group) if (!seen.has(id)) cache.rows.set(id, []);
  }
}

function putFieldValues(cache: VariantCache, productId: string, v: RawVariant): void {
  const set = (field: VariantField, value: Value) => cache.values.set(targetKey({ kind: "variant", productId, variantId: v.id, field }), value);
  set("price", v.price);
  set("compareAtPrice", v.compareAtPrice);
  set("sku", v.inventoryItem?.sku ?? null);
  set("barcode", v.barcode);
  set("tracked", String(v.inventoryItem?.tracked ?? false));
  set("policy", v.inventoryPolicy === "CONTINUE" ? "CONTINUE" : "DENY");
}

/**
 * Reads the cells of the chosen columns for these variants: the metafields (value and id) and the translations of the
 * saved metafields. Cells already read are not read again. Never writes.
 */
export async function loadVariantCells(gql: Gql, rows: VariantRow[], columns: Column[], cache: VariantCache, hooks: { shouldStop?: () => boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<void> {
  const metaCols = [...new Map(columns.filter((c) => (isMetaColumn(c) || isTranslationColumn(c)) && c.namespace && c.key).map((c) => [mfKey(c.namespace!, c.key!), c])).values()];
  const total = rows.length;
  let done = 0;
  for (const group of chunks(rows, 25)) {
    if (hooks.shouldStop?.()) return;
    const missing = metaCols.filter((c) => group.some((r) => !cache.fetched.has(`${r.id}|meta:${mfKey(c.namespace!, c.key!)}`)));
    for (const keyGroup of chunks(missing, 20)) {
      const keys = keyGroup.map((c) => ({ namespace: c.namespace!, key: c.key! }));
      const data = await gql<{ nodes: (Record<string, unknown> | null)[] }>(buildVariantMetafieldsQuery(keys), { ids: group.map((r) => r.id) });
      for (const node of data.nodes) {
        if (!node || typeof node.id !== "string") continue;
        const row = group.find((r) => r.id === node.id);
        if (!row) continue;
        keys.forEach((k, i) => {
          const m = node[`m${i}`] as { id: string; value: string | null } | null | undefined;
          const name = mfKey(k.namespace, k.key);
          const col = keyGroup[i]!;
          cache.values.set(targetKey({ kind: "metafield", productId: row.productId, ownerId: row.id, ownerKind: "PRODUCTVARIANT", namespace: k.namespace, key: k.key, type: col.mfType ?? "" }), m?.value ?? null);
          if (m?.id && m.value !== null) cache.metafieldIds.set(`${row.id}|${name}`, m.id);
          cache.fetched.add(`${row.id}|meta:${name}`);
        });
      }
    }
    done += group.length;
    hooks.onProgress?.(Math.min(done, total), total);
  }

  // translations of the saved metafields
  const tCols = columns.filter(isTranslationColumn).filter((c) => c.namespace && c.key && c.slot);
  if (tCols.length > 0) {
    const slots = [...new Set(tCols.map((c) => c.slot!))];
    for (const group of chunks(rows, 20)) {
      if (hooks.shouldStop?.()) return;
      const wanted = group.flatMap((r) => tCols.map((c) => ({ r, c, id: cache.metafieldIds.get(`${r.id}|${mfKey(c.namespace!, c.key!)}`) }))).filter((x): x is { r: VariantRow; c: Column; id: string } => !!x.id && !cache.fetched.has(`${x.r.id}|${x.c.id}`));
      if (wanted.length === 0) continue;
      const res = await loadTranslations(gql, [...new Set(wanted.map((x) => x.id))], slots);
      for (const { r, c, id } of wanted) {
        const t = variantTargetOf(c, r, cache);
        if (t) cache.values.set(targetKey(t), res[id]?.values.value?.[c.slot!]?.value ?? null);
      }
    }
  }
  for (const r of rows) for (const c of columns) cache.fetched.add(`${r.id}|${c.id}`);
}

// ---------------------------------------------------------------- the text in a cell

/** The text shown in a cell: what was typed, or the saved value. */
export function variantCellText(col: Column, row: VariantRow, cache: VariantCache, edits: Record<string, { value: Value }>): string {
  const t = variantTargetOf(col, row, cache);
  if (!t) return "";
  const k = targetKey(t);
  const value = k in edits ? edits[k]!.value : cache.values.get(k);
  return cellText(col, value);
}

export { parseCell };

/** The variants of the chosen products, in the order the products were chosen, then by position. */
export function variantRowsOf(productIds: string[], cache: Pick<VariantCache, "rows">): VariantRow[] {
  return productIds.flatMap((id) => [...(cache.rows.get(id) ?? [])].sort((a, b) => a.position - b.position));
}

/** True when the table has columns that cannot be typed into for every row. */
export const hasInlineMetafield = (def: Pick<Definition, "type">): boolean => isInlineType(def.type);

/**
 * The columns for the choices made in step 2: the chosen variant fields, then the chosen metafields, then, for each chosen
 * metafield that can be translated, one column per chosen language or market adaptation (the slots follow Block settings).
 */
export function columnsFor(fields: string[], metas: string[], slotKeys: string[], defs: Definition[], slots: Slot[]): Column[] {
  const byKey = new Map(defs.map((d) => [`${d.namespace}.${d.key}`, d]));
  const out: Column[] = VARIANT_FIELDS.filter((f) => fields.includes(f)).map(variantFieldColumn);
  const chosen = metas.map((k) => byKey.get(k)).filter((d): d is Definition => !!d);
  out.push(...chosen.map(variantMetaColumn));
  for (const d of chosen.filter((x) => translatableVariantMetafield(x.type))) {
    for (const s of slots.filter((x) => slotKeys.includes(x.key))) out.push(variantTranslationColumn(d, s.key, s.label));
  }
  return out;
}
