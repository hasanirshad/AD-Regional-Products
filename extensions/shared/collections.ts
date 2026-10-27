// Collections of a product, shared by the Sale and Badge and Collections and Tags blocks.
import type { Query } from "./graphql";

export const COLLECTION_FIELDS = "id title handle ruleSet { appliedDisjunctively }";

export type CollectionInfo = { id: string; title: string; handle: string; automated: boolean };
type RawCollection = { id: string; title: string; handle: string; ruleSet?: unknown | null };
export type RawCollections = { nodes: RawCollection[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };

export const toCollection = (c: RawCollection): CollectionInfo => ({ id: c.id, title: c.title, handle: c.handle, automated: c.ruleSet != null });

/** The first page comes with the block's main query; this reads the pages after it (up to `maxPages`). */
export async function allCollections(q: Query, productId: string, first: RawCollections, maxPages = 10): Promise<{ list: CollectionInfo[]; complete: boolean }> {
  const list = first.nodes.map(toCollection);
  let page = first.pageInfo;
  let pages = 1;
  while (page.hasNextPage && page.endCursor && pages < maxPages) {
    const next = await q<{ product: { collections: RawCollections } | null }>(
      `query MoreCollections($id: ID!, $after: String) { product(id: $id) { collections(first: 100, after: $after) { nodes { ${COLLECTION_FIELDS} } pageInfo { hasNextPage endCursor } } } }`,
      { id: productId, after: page.endCursor },
    );
    const c = next.product?.collections;
    if (!c) break;
    list.push(...c.nodes.map(toCollection));
    page = c.pageInfo;
    pages++;
  }
  return { list, complete: !page.hasNextPage };
}
