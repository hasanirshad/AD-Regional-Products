import { LANGUAGES, MARKETS, SALE_BADGE, SALE_COLLECTION_HANDLE, type MarketDef } from "../../shared/constants";
import { allCollections, COLLECTION_FIELDS, type RawCollections } from "../../shared/collections";
import { discountPercent } from "../../shared/format";
import { aliasOf, gqlString, localeLiteral, type BlockError, type LoadContext } from "../../shared/graphql";
import { withPricing, type MarketPrice } from "../../shared/pricing";
import { cellFor, type Cell, type Content, type Translations } from "../../shared/translations";

type Raw = {
  product: (Record<string, unknown> & { id: string; badge?: { id: string; value?: string | null } | null; collections: RawCollections }) | null;
};

const query = (selection: string) => `query SaleBadge($id: ID!) {
  product(id: $id) {
    id
    badge: metafield(namespace: ${gqlString(SALE_BADGE.namespace)}, key: ${gqlString(SALE_BADGE.key)}) { id value }
    collections(first: 100) { nodes { ${COLLECTION_FIELDS} } pageInfo { hasNextPage endCursor } }
    ${selection}
  }
}`;

const alias = (code: string) => `tr_${aliasOf(code)}`;
const TRANSLATIONS = () => `query BadgeTranslations($id: ID!) {
  translatableResource(resourceId: $id) {
    translatableContent { key value }
    ${LANGUAGES.map((l) => `${alias(l.code)}: translations(locale: ${localeLiteral(l.code)}) { key value outdated }`).join("\n    ")}
  }
}`;

export type SaleRow = { def: MarketDef; price: MarketPrice | null; discounts: (number | null)[]; onSale: boolean };
export type BadgeInfo = {
  value: string | null;
  /** null when the translations could not be read. */
  translations: Record<string, Cell> | null;
  translationError: BlockError | null;
};
export type Data = { rows: SaleRow[]; badge: BadgeInfo; inSaleCollection: boolean; collectionsComplete: boolean; note: string | null };

export function saleRow(def: MarketDef, price: MarketPrice | null): SaleRow {
  const discounts = price ? [discountPercent(price.low.price, price.low.compareAt), discountPercent(price.high.price, price.high.compareAt)] : [];
  return { def, price, discounts, onSale: discounts.some((d) => d != null) };
}

export async function load({ productId, q, soft }: LoadContext): Promise<Data> {
  const countries = MARKETS.map((m) => m.country);
  const { result, pricing } = await withPricing(q, productId, countries, (selection) => q<Raw>(query(selection), { id: productId }));
  const product = result.product;
  if (!product) throw new Error("Product not found");

  const [{ list, complete }, badge] = await Promise.all([
    allCollections(q, productId, product.collections),
    (async (): Promise<BadgeInfo> => {
      const value = product.badge?.value?.trim() || null;
      if (!product.badge?.id) return { value, translations: null, translationError: null };
      const res = await soft<{ translatableResource: ({ translatableContent: Content } & Record<string, unknown>) | null }>(TRANSLATIONS(), { id: product.badge.id });
      const r = res.data?.translatableResource;
      if (!r) return { value, translations: null, translationError: res.error };
      const translations = Object.fromEntries(LANGUAGES.map((l) => [l.code, cellFor(r.translatableContent ?? [], (r[alias(l.code)] as Translations | undefined) ?? [], "value")]));
      return { value, translations, translationError: res.error };
    })(),
  ]);

  return {
    rows: MARKETS.map((def) => saleRow(def, pricing.prices[def.country] ?? null)),
    badge,
    inSaleCollection: list.some((c) => c.handle === SALE_COLLECTION_HANDLE),
    collectionsComplete: complete,
    note: pricing.note,
  };
}
