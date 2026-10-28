// Bulk edit, the reading part. Reads are free. Values are read in groups of products and handed over group by group, so
// the table fills as it goes, and a Stop button can end a long read between two groups.

import { targetKey, type Target, type Value } from "./model";
import { targetOf, type Column } from "./bulk";
import { chunks, type Gql } from "./gql";
import { readValues } from "./read";

/** Products read together. A read is several small queries, so this stays well inside Shopify's cost limit. */
export const BATCH = 50;

/** What has been read so far. Values are keyed by targetKey; variantIds says which products have exactly one variant. */
export type Cache = {
  values: Map<string, Value>;
  /** product id -> its only variant, or null when it has several (or none). Missing = not looked at yet. */
  variantIds: Map<string, string | null>;
  /** "productId|columnId" for every cell that was asked for, found or not (a deleted product's cells are not waited for). */
  fetched: Set<string>;
};

export const newCache = (): Cache => ({ values: new Map(), variantIds: new Map(), fetched: new Set() });

const SINGLE_VARIANT_QUERY = `#graphql
  query BulkSingleVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id variants(first: 2) { nodes { id } } }
    }
  }`;

/** Looks up the variant of each product that has exactly one. */
export async function loadSingleVariants(gql: Gql, productIds: string[], into: Map<string, string | null>): Promise<void> {
  const todo = productIds.filter((id) => !into.has(id));
  for (const group of chunks(todo, BATCH)) {
    const data = await gql<{ nodes: ({ id: string; variants: { nodes: { id: string }[] } } | null)[] }>(SINGLE_VARIANT_QUERY, { ids: group });
    const seen = new Set<string>();
    for (const n of data.nodes) {
      if (!n?.id) continue;
      seen.add(n.id);
      into.set(n.id, n.variants.nodes.length === 1 ? n.variants.nodes[0]!.id : null);
    }
    for (const id of group) if (!seen.has(id)) into.set(id, null);
  }
}

/** The targets of these columns for these products. A price column needs the variant ids first. */
export function targetsFor(columns: Column[], productIds: string[], variantIds: Map<string, string | null>): Target[] {
  const out: Target[] = [];
  for (const id of productIds) {
    for (const col of columns) {
      const t = targetOf(col, id, variantIds.get(id) ?? null);
      if (t) out.push(t);
    }
  }
  return out;
}

export type LoadHooks = {
  /** Called after each group, with the number of products finished so far. */
  onProgress?: (done: number, total: number) => void;
  shouldStop?: () => boolean;
};

/**
 * Reads the cells that are not in the cache yet, into the cache. Returns how many products were finished.
 * A product that no longer exists gets no values (its cells stay empty and it is reported as missing by the caller).
 */
export async function loadCells(gql: Gql, productIds: string[], columns: Column[], cache: Cache, hooks: LoadHooks = {}): Promise<number> {
  const needsVariant = columns.some((c) => c.group === "Variant");
  let done = 0;
  const total = productIds.length;
  for (const group of chunks(productIds, BATCH)) {
    if (hooks.shouldStop?.()) break;
    if (needsVariant) await loadSingleVariants(gql, group, cache.variantIds);
    const wanted = targetsFor(columns, group, cache.variantIds).filter((t) => !cache.values.has(targetKey(t)));
    if (wanted.length > 0) {
      const got = await readValues(gql, wanted);
      for (const [k, v] of got) cache.values.set(k, v);
    }
    for (const id of group) for (const col of columns) cache.fetched.add(`${id}|${col.id}`);
    done += group.length;
    hooks.onProgress?.(done, total);
  }
  return done;
}

// ---------------------------------------------------------------- collections

export type CollectionChoice = { id: string; title: string };

const COLLECTIONS_QUERY = `#graphql
  query BulkCollections($after: String) {
    collections(first: 100, after: $after, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes { id title }
    }
  }`;

/** Up to 1,000 collections, by title. */
export async function loadCollections(gql: Gql): Promise<CollectionChoice[]> {
  const out: CollectionChoice[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: { collections: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: CollectionChoice[] } } = await gql(COLLECTIONS_QUERY, { after });
    out.push(...data.collections.nodes);
    if (!data.collections.pageInfo.hasNextPage) break;
    after = data.collections.pageInfo.endCursor;
  }
  return out;
}

const COLLECTION_PRODUCTS_QUERY = `#graphql
  query BulkCollectionProducts($id: ID!, $after: String) {
    collection(id: $id) {
      products(first: 250, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  }`;

/** The ids of the products in a collection (up to 10,000). */
export async function loadCollectionProducts(gql: Gql, id: string): Promise<Set<string>> {
  const out = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data: { collection: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string }[] } } | null } = await gql(COLLECTION_PRODUCTS_QUERY, { id, after });
    if (!data.collection) throw new Error("That collection no longer exists.");
    for (const n of data.collection.products.nodes) out.add(n.id);
    if (!data.collection.products.pageInfo.hasNextPage) break;
    after = data.collection.products.pageInfo.endCursor;
  }
  return out;
}
