// Reading the CURRENT value of any list of targets, fresh from Shopify. One reader serves three jobs:
//   - recheck: just before a write, is the store still what the review was built from?
//   - read-back: after a write, does Shopify really show what was asked for?
//   - Bulk edit: the values shown in the table.
// Reads are free. Values come back in the same text form as doc.ts (`baseOf`), keyed by targetKey.

import { tagsToValue } from "./canon";
import { chunks, gqlString, type Gql } from "./gql";
import { loadTranslations } from "./load";
import { targetKey, type ProductField, type Target, type Value, type VariantField } from "./model";
import { mfKey } from "./doc";

export type Values = Map<string, Value>;

type RawProductFields = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string | null;
  vendor: string | null;
  status: string;
  productType: string | null;
  tags: string[];
  seo: { title: string | null; description: string | null } | null;
  category: { id: string } | null;
};

export const PRODUCT_FIELDS_QUERY = `#graphql
  query ReadProductFields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        descriptionHtml
        vendor
        status
        productType
        tags
        seo { title description }
        category { id name }
      }
    }
  }`;

export function productFieldValue(p: RawProductFields, field: ProductField): Value {
  switch (field) {
    case "title":
      return p.title;
    case "descriptionHtml":
      return p.descriptionHtml || null;
    case "vendor":
      return p.vendor || null;
    case "status":
      return p.status;
    case "seoTitle":
      return p.seo?.title || null;
    case "seoDescription":
      return p.seo?.description || null;
    case "handle":
      return p.handle;
    case "productType":
      return p.productType || null;
    case "category":
      return p.category?.id ?? null;
    case "tags":
      return tagsToValue(p.tags);
  }
}

type RawVariantFields = {
  id: string;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  inventoryPolicy: string;
  inventoryItem: { tracked: boolean; sku: string | null } | null;
};

export const VARIANT_FIELDS_QUERY = `#graphql
  query ReadVariantFields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        price
        compareAtPrice
        barcode
        inventoryPolicy
        inventoryItem { tracked sku }
      }
    }
  }`;

export function variantFieldValue(v: RawVariantFields, field: VariantField): Value {
  switch (field) {
    case "price":
      return v.price;
    case "compareAtPrice":
      return v.compareAtPrice;
    case "sku":
      return v.inventoryItem?.sku ?? null;
    case "barcode":
      return v.barcode;
    case "tracked":
      return String(v.inventoryItem?.tracked ?? false);
    case "policy":
      return v.inventoryPolicy === "CONTINUE" ? "CONTINUE" : "DENY";
  }
}

export const STOCK_QUERY = `#graphql
  query ReadStock($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        inventoryItem {
          inventoryLevels(first: 10) {
            nodes { location { id } quantities(names: ["available"]) { name quantity } }
          }
        }
      }
    }
  }`;

export function buildMetafieldsRead(keys: { namespace: string; key: string }[]): string {
  const fields = keys.map((k, i) => `m${i}: metafield(namespace: ${gqlString(k.namespace)}, key: ${gqlString(k.key)}) { value }`).join("\n        ");
  return `#graphql
  query ReadMetafields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id ${fields} }
      ... on ProductVariant { id ${fields} }
    }
  }`;
}

/**
 * The current value of each target. A target whose product or variant no longer exists is left out of the result.
 * `onProgress` is called after each request, for a progress bar on long reads.
 */
export async function readValues(gql: Gql, targets: Target[], onProgress?: (done: number, total: number) => void): Promise<Values> {
  const out: Values = new Map();
  let done = 0;
  const total = targets.length;
  const tick = (n: number) => {
    done += n;
    onProgress?.(Math.min(done, total), total);
  };

  // products
  const products = targets.filter((t): t is Extract<Target, { kind: "product" }> => t.kind === "product");
  const productIds = [...new Set(products.map((t) => t.productId))];
  const rawProducts = new Map<string, RawProductFields>();
  for (const group of chunks(productIds, 50)) {
    const data = await gql<{ nodes: (RawProductFields | null)[] }>(PRODUCT_FIELDS_QUERY, { ids: group });
    for (const n of data.nodes) if (n?.id) rawProducts.set(n.id, n);
  }
  for (const t of products) {
    const raw = rawProducts.get(t.productId);
    if (raw) out.set(targetKey(t), productFieldValue(raw, t.field));
  }
  tick(products.length);

  // variants
  const variants = targets.filter((t): t is Extract<Target, { kind: "variant" }> => t.kind === "variant");
  const variantIds = [...new Set(variants.map((t) => t.variantId))];
  const rawVariants = new Map<string, RawVariantFields>();
  for (const group of chunks(variantIds, 50)) {
    const data = await gql<{ nodes: (RawVariantFields | null)[] }>(VARIANT_FIELDS_QUERY, { ids: group });
    for (const n of data.nodes) if (n?.id) rawVariants.set(n.id, n);
  }
  for (const t of variants) {
    const raw = rawVariants.get(t.variantId);
    if (raw) out.set(targetKey(t), variantFieldValue(raw, t.field));
  }
  tick(variants.length);

  // stock
  const stock = targets.filter((t): t is Extract<Target, { kind: "stock" }> => t.kind === "stock");
  const stockVariantIds = [...new Set(stock.map((t) => t.variantId))];
  const levels = new Map<string, Map<string, number>>();
  for (const group of chunks(stockVariantIds, 25)) {
    const data = await gql<{
      nodes: ({ id: string; inventoryItem: { inventoryLevels: { nodes: { location: { id: string }; quantities: { name: string; quantity: number }[] }[] } } | null } | null)[];
    }>(STOCK_QUERY, { ids: group });
    for (const n of data.nodes) {
      if (!n?.id) continue;
      const m = new Map<string, number>();
      for (const l of n.inventoryItem?.inventoryLevels.nodes ?? []) m.set(l.location.id, l.quantities.find((q) => q.name === "available")?.quantity ?? 0);
      levels.set(n.id, m);
    }
  }
  for (const t of stock) {
    const m = levels.get(t.variantId);
    if (m) out.set(targetKey(t), m.has(t.locationId) ? String(m.get(t.locationId)) : null);
  }
  tick(stock.length);

  // metafields
  const metafields = targets.filter((t): t is Extract<Target, { kind: "metafield" }> => t.kind === "metafield");
  if (metafields.length > 0) {
    const keys = new Map<string, { namespace: string; key: string }>();
    for (const t of metafields) keys.set(mfKey(t.namespace, t.key), { namespace: t.namespace, key: t.key });
    const owners = [...new Set(metafields.map((t) => t.ownerId))];
    const found = new Map<string, Value>();
    const seenOwners = new Set<string>();
    for (const keyGroup of chunks([...keys.values()], 20)) {
      const query = buildMetafieldsRead(keyGroup);
      for (const group of chunks(owners, 25)) {
        const data = await gql<{ nodes: (Record<string, unknown> | null)[] }>(query, { ids: group });
        for (const node of data.nodes) {
          if (!node || typeof node.id !== "string") continue;
          seenOwners.add(node.id);
          keyGroup.forEach((k, i) => {
            const m = node[`m${i}`] as { value: string | null } | null | undefined;
            found.set(`${node.id}|${mfKey(k.namespace, k.key)}`, m?.value ?? null);
          });
        }
      }
    }
    for (const t of metafields) {
      if (seenOwners.has(t.ownerId)) out.set(targetKey(t), found.get(`${t.ownerId}|${mfKey(t.namespace, t.key)}`) ?? null);
    }
  }
  tick(metafields.length);

  // translations
  const translations = targets.filter((t): t is Extract<Target, { kind: "translation" }> => t.kind === "translation");
  if (translations.length > 0) {
    const slots = [...new Set(translations.map((t) => t.slot))];
    const resources = [...new Set(translations.map((t) => t.resourceId))];
    const res = await loadTranslations(gql, resources, slots);
    for (const t of translations) {
      const r = res[t.resourceId];
      if (r) out.set(targetKey(t), r.values[t.field]?.[t.slot]?.value ?? null);
    }
  }
  tick(translations.length);
  return out;
}
