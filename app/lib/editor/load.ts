// Reads for the editor: one product in full, the store's metafield definitions, languages, locations and reference
// names. Reads are free (no password). Queries are kept small: Shopify refuses a query whose requested cost is over 1,000.


import { mfKey, noteCategory, type MetafieldDoc, type ProductDoc, type StockLevelDoc, type TranslationRes, type VariantDoc } from "./doc";
import { chunks, gqlString, type Gql } from "./gql";
import { parseSlot, type ShopLocale } from "./locales";
import type { OwnerKind } from "./mfTypes";
import type { Validation } from "./mfRules";

// ---------------------------------------------------------------- product

export const PRODUCT_QUERY = `#graphql
  query EditorProduct($id: ID!) {
    product(id: $id) {
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
      options { name optionValues { name } }
      variantsCount { count }
      metafields(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { id namespace key type value compareDigest }
      }
    }
  }`;

export const PRODUCT_METAFIELDS_MORE = `#graphql
  query EditorProductMetafields($id: ID!, $after: String) {
    product(id: $id) {
      metafields(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id namespace key type value compareDigest }
      }
    }
  }`;

/** 25 variants x 10 locations stays well under the cost limit. */
export const VARIANTS_PAGE = 25;
export const MAX_VARIANT_PAGES = 10;

export const VARIANTS_QUERY = `#graphql
  query EditorVariants($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: ${VARIANTS_PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          position
          price
          compareAtPrice
          barcode
          inventoryPolicy
          selectedOptions { name value }
          inventoryItem {
            id
            tracked
            sku
            inventoryLevels(first: 10) {
              nodes {
                location { id }
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
    }
  }`;

type RawMetafield = { id: string; namespace: string; key: string; type: string; value: string | null; compareDigest?: string | null };

type RawProduct = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string | null;
  vendor: string | null;
  status: string;
  productType: string | null;
  tags: string[];
  seo: { title: string | null; description: string | null } | null;
  category: { id: string; name: string } | null;
  options: { name: string; optionValues: { name: string }[] }[];
  variantsCount: { count: number } | null;
  metafields: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawMetafield[] };
};

type RawVariant = {
  id: string;
  title: string;
  position: number;
  price: string;
  compareAtPrice: string | null;
  barcode: string | null;
  inventoryPolicy: string;
  selectedOptions: { name: string; value: string }[];
  inventoryItem: {
    id: string;
    tracked: boolean;
    sku: string | null;
    inventoryLevels: { nodes: { location: { id: string }; quantities: { name: string; quantity: number }[] }[] };
  } | null;
};

export function parseMetafield(m: RawMetafield): MetafieldDoc | null {
  if (m.value === null || m.value === undefined) return null;
  return { id: m.id, value: m.value, type: m.type, digest: m.compareDigest ?? null };
}

export function parseVariant(v: RawVariant): VariantDoc {
  const levels: StockLevelDoc[] = (v.inventoryItem?.inventoryLevels.nodes ?? []).map((l) => ({
    locationId: l.location.id,
    quantity: l.quantities.find((q) => q.name === "available")?.quantity ?? 0,
  }));
  return {
    id: v.id,
    title: v.title,
    position: v.position,
    options: v.selectedOptions,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    sku: v.inventoryItem?.sku ?? null,
    barcode: v.barcode,
    policy: v.inventoryPolicy === "CONTINUE" ? "CONTINUE" : "DENY",
    tracked: v.inventoryItem?.tracked ?? false,
    itemId: v.inventoryItem?.id ?? "",
    levels,
    metafields: {},
  };
}

export function parseProduct(p: RawProduct, variants: VariantDoc[], variantsTruncated: boolean, metafields: RawMetafield[]): ProductDoc {
  const mfs: Record<string, MetafieldDoc> = {};
  for (const m of metafields) {
    const doc = parseMetafield(m);
    if (doc) mfs[mfKey(m.namespace, m.key)] = doc;
  }
  const doc: ProductDoc = {
    id: p.id,
    title: p.title,
    handle: p.handle,
    descriptionHtml: p.descriptionHtml ?? "",
    vendor: p.vendor ?? "",
    status: p.status,
    seoTitle: p.seo?.title ?? "",
    seoDescription: p.seo?.description ?? "",
    productType: p.productType ?? "",
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    tags: p.tags,
    options: p.options.map((o) => ({ name: o.name, values: o.optionValues.map((x) => x.name) })),
    variants,
    variantsTruncated,
    variantCount: p.variantsCount?.count ?? variants.length,
    metafields: mfs,
    translations: {},
  };
  noteCategory(doc);
  return doc;
}

/** The product, its variants (with stock) and all its product metafields. Translations are read separately. */
export async function loadProduct(gql: Gql, id: string): Promise<ProductDoc> {
  const [head, variantsRead] = await Promise.all([gql<{ product: RawProduct | null }>(PRODUCT_QUERY, { id }), loadVariants(gql, id)]);
  if (!head.product) throw new Error("This product no longer exists in Shopify.");
  const raw = [...head.product.metafields.nodes];
  let more = head.product.metafields.pageInfo;
  for (let page = 0; more.hasNextPage && page < 5; page++) {
    const next: { product: { metafields: RawProduct["metafields"] } | null } = await gql(PRODUCT_METAFIELDS_MORE, { id, after: more.endCursor });
    if (!next.product) break;
    raw.push(...next.product.metafields.nodes);
    more = next.product.metafields.pageInfo;
  }
  return parseProduct(head.product, variantsRead.variants, variantsRead.truncated, raw);
}

export async function loadVariants(gql: Gql, id: string): Promise<{ variants: VariantDoc[]; truncated: boolean }> {
  const out: VariantDoc[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_VARIANT_PAGES; page++) {
    const data: { product: { variants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawVariant[] } } | null } = await gql(VARIANTS_QUERY, { id, after });
    if (!data.product) break;
    out.push(...data.product.variants.nodes.map(parseVariant));
    if (!data.product.variants.pageInfo.hasNextPage) return { variants: out, truncated: false };
    after = data.product.variants.pageInfo.endCursor;
  }
  return { variants: out, truncated: true };
}

// ---------------------------------------------------------------- variant metafields (only the chosen ones)

/** Reads the chosen metafields of variants. `keys` are { namespace, key }. 25 variants x up to 20 keys per request. */
export function buildVariantMetafieldsQuery(keys: { namespace: string; key: string }[]): string {
  const fields = keys
    .map((k, i) => `m${i}: metafield(namespace: ${gqlString(k.namespace)}, key: ${gqlString(k.key)}) { id type value compareDigest }`)
    .join("\n        ");
  return `#graphql
  query EditorVariantMetafields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        ${fields}
      }
    }
  }`;
}

export async function loadVariantMetafields(
  gql: Gql,
  variantIds: string[],
  keys: { namespace: string; key: string }[],
): Promise<Record<string, Record<string, MetafieldDoc | null>>> {
  const out: Record<string, Record<string, MetafieldDoc | null>> = {};
  for (const id of variantIds) out[id] = {};
  for (const keyGroup of chunks(keys, 20)) {
    const query = buildVariantMetafieldsQuery(keyGroup);
    for (const group of chunks(variantIds, 25)) {
      const data = await gql<{ nodes: (Record<string, unknown> | null)[] }>(query, { ids: group });
      for (const node of data.nodes) {
        if (!node || typeof node.id !== "string") continue;
        const row = out[node.id] ?? (out[node.id] = {});
        keyGroup.forEach((k, i) => {
          const m = node[`m${i}`] as { id: string; type: string; value: string | null; compareDigest?: string | null } | null | undefined;
          row[mfKey(k.namespace, k.key)] = m && m.value !== null ? { id: m.id, type: m.type, value: m.value, digest: m.compareDigest ?? null } : null;
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- definitions, languages, locations

export type Definition = {
  id: string;
  ownerKind: OwnerKind;
  namespace: string;
  key: string;
  name: string;
  description: string;
  type: string;
  validations: Validation[];
};

export const defKey = (d: Pick<Definition, "namespace" | "key">): string => mfKey(d.namespace, d.key);

export const DEFINITIONS_QUERY = `#graphql
  query EditorDefinitions($ownerType: MetafieldOwnerType!, $after: String) {
    metafieldDefinitions(ownerType: $ownerType, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        namespace
        key
        name
        description
        type { name }
        validations { name value }
      }
    }
  }`;

type RawDefinition = { id: string; namespace: string; key: string; name: string; description?: string | null; type: { name: string }; validations?: Validation[] | null };

export async function loadDefinitions(gql: Gql, ownerKind: OwnerKind): Promise<Definition[]> {
  const out: Definition[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data: { metafieldDefinitions: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawDefinition[] } } = await gql(DEFINITIONS_QUERY, { ownerType: ownerKind, after });
    for (const n of data.metafieldDefinitions.nodes) {
      out.push({ id: n.id, ownerKind, namespace: n.namespace, key: n.key, name: n.name, description: n.description ?? "", type: n.type.name, validations: n.validations ?? [] });
    }
    if (!data.metafieldDefinitions.pageInfo.hasNextPage) break;
    after = data.metafieldDefinitions.pageInfo.endCursor;
  }
  return out.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}

export const SHOP_INFO_QUERY = `#graphql
  query EditorShop {
    shop { name myshopifyDomain currencyCode }
    shopLocales { locale name primary published }
    locations(first: 50) { nodes { id name } }
  }`;

export type ShopInfo = {
  name: string;
  domain: string;
  currency: string;
  locales: ShopLocale[];
  locations: { id: string; name: string }[];
};

export async function loadShopInfo(gql: Gql): Promise<ShopInfo> {
  const data = await gql<{
    shop: { name: string; myshopifyDomain: string; currencyCode: string };
    shopLocales: ShopLocale[];
    locations: { nodes: { id: string; name: string }[] };
  }>(SHOP_INFO_QUERY);
  return { name: data.shop.name, domain: data.shop.myshopifyDomain, currency: data.shop.currencyCode, locales: data.shopLocales, locations: data.locations.nodes };
}

// ---------------------------------------------------------------- reference names

export const REF_LABELS_QUERY = `#graphql
  query EditorRefLabels($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Product { id title }
      ... on Collection { id title }
      ... on ProductVariant { id displayName }
    }
  }`;

/** Names for product, collection and variant ids (so a reference shows its name, not a number). */
export async function loadRefLabels(gql: Gql, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const group of chunks([...new Set(ids)], 50)) {
    const data = await gql<{ nodes: ({ id?: string; title?: string; displayName?: string } | null)[] }>(REF_LABELS_QUERY, { ids: group });
    for (const n of data.nodes) if (n?.id) out[n.id] = n.title ?? n.displayName ?? n.id;
  }
  return out;
}

// ---------------------------------------------------------------- translations

/** One aliased `translations` field per slot. */
export function buildTranslationsQuery(slots: string[]): string {
  const parsed = slots.map(parseSlot);
  const vars = parsed.map((p, i) => `, $l${i}: String!${p.marketId ? `, $m${i}: ID!` : ""}`).join("");
  const anyMarket = parsed.some((p) => p.marketId);
  const aliases = parsed
    .map((p, i) => `t${i}: translations(${p.marketId ? `locale: $l${i}, marketId: $m${i}` : `locale: $l${i}`}) { key value outdated${anyMarket ? " market { id }" : ""} }`)
    .join("\n        ");
  return `#graphql
  query EditorTranslations($ids: [ID!]!, $first: Int!${vars}) {
    translatableResourcesByIds(resourceIds: $ids, first: $first) {
      nodes {
        resourceId
        translatableContent { key value digest locale }
        ${aliases}
      }
    }
  }`;
}

type TranslationNode = {
  resourceId: string;
  translatableContent: { key: string; value: string | null; digest: string | null }[];
  [alias: string]: unknown;
};

type TranslationEntry = { key: string; value: string | null; outdated: boolean; market?: { id: string } | null };

/** Pure: API nodes -> translations by resource id. */
export function parseTranslationNodes(nodes: TranslationNode[], slots: string[]): Record<string, TranslationRes> {
  const out: Record<string, TranslationRes> = {};
  for (const node of nodes) {
    const res: TranslationRes = { content: {}, values: {} };
    for (const c of node.translatableContent ?? []) {
      if (c.value !== null && c.digest) res.content[c.key] = { value: c.value, digest: c.digest };
    }
    slots.forEach((slot, i) => {
      const wantedMarket = parseSlot(slot).marketId;
      const list = (node[`t${i}`] as TranslationEntry[] | undefined) ?? [];
      for (const entry of list) {
        // A language slot only takes text that is for every market; an adaptation only takes text for its own market.
        if ((entry.market?.id ?? null) !== wantedMarket) continue;
        if (entry.value === null || entry.value === "") continue;
        (res.values[entry.key] ??= {})[slot] = { value: entry.value, outdated: Boolean(entry.outdated) };
      }
    });
    out[node.resourceId] = res;
  }
  return out;
}

/** Reads the source text digests and saved translations of resources (the product, or its metafields). */
export async function loadTranslations(gql: Gql, resourceIds: string[], slots: string[]): Promise<Record<string, TranslationRes>> {
  const out: Record<string, TranslationRes> = {};
  if (resourceIds.length === 0 || slots.length === 0) return out;
  const query = buildTranslationsQuery(slots);
  for (const group of chunks([...new Set(resourceIds)], 20)) {
    const variables: Record<string, unknown> = { ids: group, first: group.length };
    slots.forEach((slot, i) => {
      const { locale, marketId } = parseSlot(slot);
      variables[`l${i}`] = locale;
      if (marketId) variables[`m${i}`] = marketId;
    });
    const data = await gql<{ translatableResourcesByIds: { nodes: TranslationNode[] } }>(query, variables);
    Object.assign(out, parseTranslationNodes(data.translatableResourcesByIds.nodes, slots));
  }
  return out;
}

/** Everything the page needs for one product: the product, plus translations of the product and of its metafields. */
export async function loadProductDoc(gql: Gql, id: string, slots: string[]): Promise<ProductDoc> {
  const doc = await loadProduct(gql, id);
  doc.translations = await loadTranslations(gql, [doc.id, ...Object.values(doc.metafields).map((m) => m.id)], slots);
  return doc;
}

// ---------------------------------------------------------------- finding products and categories

export const SEARCH_QUERY = `#graphql
  query EditorSearch($query: String!) {
    products(first: 15, query: $query, sortKey: RELEVANCE) {
      nodes { id title handle status vendor productType }
    }
  }`;

export type FoundProduct = { id: string; title: string; handle: string; status: string; vendor: string; productType: string };

/** Search text for Shopify: title or handle start with the text, or a variant SKU does. Quotes are removed from what was typed. */
export function searchQueryFor(text: string): string {
  const t = text.replace(/["'\\()]/g, " ").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const word = t.split(" ").join("* ");
  const sku = t.replace(/\s+/g, "");
  return `(title:${word}*) OR (handle:${t.replace(/\s+/g, "-").toLowerCase()}*) OR (sku:${sku}*)`;
}

export async function searchProducts(gql: Gql, text: string): Promise<FoundProduct[]> {
  const query = searchQueryFor(text);
  if (!query) return [];
  const data = await gql<{ products: { nodes: FoundProduct[] } }>(SEARCH_QUERY, { query });
  return data.products.nodes;
}

export const TAXONOMY_QUERY = `#graphql
  query EditorCategories($search: String!) {
    taxonomy {
      categories(first: 20, search: $search) { nodes { id name fullName isLeaf } }
    }
  }`;

export type CategoryChoice = { id: string; name: string; fullName: string; isLeaf: boolean };

export async function searchCategories(gql: Gql, text: string): Promise<CategoryChoice[]> {
  const data = await gql<{ taxonomy: { categories: { nodes: CategoryChoice[] } } }>(TAXONOMY_QUERY, { search: text });
  return data.taxonomy.categories.nodes;
}

// ---------------------------------------------------------------- digests (fresh, just before translations are written)

export const DIGESTS_QUERY = `#graphql
  query EditorDigests($ids: [ID!]!, $first: Int!) {
    translatableResourcesByIds(resourceIds: $ids, first: $first) {
      nodes { resourceId translatableContent { key value digest } }
    }
  }`;

/** resource id -> field -> the source text and its digest. A translation must quote the digest of the source it translates. */
export async function loadDigests(gql: Gql, resourceIds: string[]): Promise<Record<string, Record<string, { value: string; digest: string }>>> {
  const out: Record<string, Record<string, { value: string; digest: string }>> = {};
  for (const group of chunks([...new Set(resourceIds)], 20)) {
    const data = await gql<{ translatableResourcesByIds: { nodes: TranslationNode[] } }>(DIGESTS_QUERY, { ids: group, first: group.length });
    for (const node of data.translatableResourcesByIds.nodes) {
      const row: Record<string, { value: string; digest: string }> = {};
      for (const c of node.translatableContent ?? []) if (c.value !== null && c.digest) row[c.key] = { value: c.value, digest: c.digest };
      out[node.resourceId] = row;
    }
  }
  return out;
}
