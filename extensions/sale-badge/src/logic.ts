import type { MarketDef } from "../../shared/constants";
import { allCollections, COLLECTION_FIELDS, type RawCollections } from "../../shared/collections";
import { discountPercent } from "../../shared/format";
import { aliasOf, gqlString, localeLiteral } from "../../shared/pure";
import type { BlockError, LoadContext } from "../../shared/query";
import { withPricing, type MarketPrice } from "../../shared/pricing";
import { marketCountries, marketDefs, settingsOf, type Language } from "../../shared/settings";
import { cellFor, type Cell, type Content, type Translations } from "../../shared/translationCells";

type Raw = {
  product: (Record<string, unknown> & { id: string; badge?: { id: string; value?: string | null } | null; collections: RawCollections }) | null;
};

const query = (badge: { namespace: string; key: string }, selection: string) => `query SaleBadge($id: ID!) {
  product(id: $id) {
    id
    badge: metafield(namespace: ${gqlString(badge.namespace)}, key: ${gqlString(badge.key)}) { id value }
    collections(first: 100) { nodes { ${COLLECTION_FIELDS} } pageInfo { hasNextPage endCursor } }
    ${selection}
  }
}`;

const alias = (code: string) => `tr_${aliasOf(code)}`;
const TRANSLATIONS = (languages: Language[]) => `query BadgeTranslations($id: ID!) {
  translatableResource(resourceId: $id) {
    translatableContent { key value }
    ${languages.map((l) => `${alias(l.code)}: translations(locale: ${localeLiteral(l.code)}) { key value outdated }`).join("\n    ")}
  }
}`;

export type SaleRow = { def: MarketDef; price: MarketPrice | null; discounts: (number | null)[]; onSale: boolean };
export type BadgeInfo = {
  value: string | null;
  /** null when the translations could not be read. */
  translations: Record<string, Cell> | null;
  translationError: BlockError | null;
};
export type Data = {
  rows: SaleRow[];
  badge: BadgeInfo;
  inSaleCollection: boolean;
  collectionsComplete: boolean;
  note: string | null;
  /** What the settings ask for, so the view can name them. */
  config: { badgeNamespace: string; badgeKey: string; collectionHandle: string; languages: Language[] };
};

export function saleRow(def: MarketDef, price: MarketPrice | null): SaleRow {
  const discounts = price ? [discountPercent(price.low.price, price.low.compareAt), discountPercent(price.high.price, price.high.compareAt)] : [];
  return { def, price, discounts, onSale: discounts.some((d) => d != null) };
}

export async function load(ctx: LoadContext): Promise<Data> {
  const { productId, q, soft } = ctx;
  const settings = settingsOf(ctx);
  const defs = marketDefs(settings);
  const countries = marketCountries(defs);
  const { languages } = settings;
  const badgeKey = { namespace: settings.sale.badgeNamespace, key: settings.sale.badgeKey };
  const { result, pricing } = await withPricing(q, productId, countries, (selection) => q<Raw>(query(badgeKey, selection), { id: productId }));
  const product = result.product;
  if (!product) throw new Error("Product not found");

  const [{ list, complete }, badge] = await Promise.all([
    allCollections(q, productId, product.collections),
    (async (): Promise<BadgeInfo> => {
      const value = product.badge?.value?.trim() || null;
      if (!product.badge?.id) return { value, translations: null, translationError: null };
      const res = await soft<{ translatableResource: ({ translatableContent: Content } & Record<string, unknown>) | null }>(TRANSLATIONS(languages), { id: product.badge.id });
      const r = res.data?.translatableResource;
      if (!r) return { value, translations: null, translationError: res.error };
      const translations = Object.fromEntries(languages.map((l) => [l.code, cellFor(r.translatableContent ?? [], (r[alias(l.code)] as Translations | undefined) ?? [], "value")]));
      return { value, translations, translationError: res.error };
    })(),
  ]);

  return {
    rows: defs.map((def) => saleRow(def, pricing.prices[def.country] ?? null)),
    badge,
    inSaleCollection: settings.sale.collectionHandle !== "" && list.some((c) => c.handle === settings.sale.collectionHandle),
    collectionsComplete: complete,
    note: pricing.note,
    config: { badgeNamespace: badgeKey.namespace, badgeKey: badgeKey.key, collectionHandle: settings.sale.collectionHandle, languages },
  };
}
