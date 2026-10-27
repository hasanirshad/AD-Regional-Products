import { allCollections, COLLECTION_FIELDS, type CollectionInfo, type RawCollections } from "../../shared/collections";
import { adminCollectionUrl, shopHandle } from "../../shared/admin";
import type { LoadContext } from "../../shared/graphql";

export type Data = { collections: (CollectionInfo & { url: string })[]; tags: string[]; complete: boolean };

const QUERY = `query CollectionsTags($id: ID!) {
  shop { myshopifyDomain }
  product(id: $id) {
    id
    tags
    collections(first: 100) { nodes { ${COLLECTION_FIELDS} } pageInfo { hasNextPage endCursor } }
  }
}`;

export async function load({ productId, q }: LoadContext): Promise<Data> {
  const d = await q<{ shop: { myshopifyDomain: string }; product: { tags: string[]; collections: RawCollections } | null }>(QUERY, { id: productId });
  if (!d.product) throw new Error("Product not found");
  const handle = shopHandle(d.shop.myshopifyDomain);
  const { list, complete } = await allCollections(q, productId, d.product.collections);
  return {
    collections: [...list].sort((a, b) => a.title.localeCompare(b.title)).map((c) => ({ ...c, url: adminCollectionUrl(handle, c.id) })),
    tags: [...d.product.tags].sort((a, b) => a.localeCompare(b)),
    complete,
  };
}
