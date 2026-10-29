// Fixtures for the health checks, modelled on the Hardman store export (150 active products, 1064 variants):
// a real product, an option product (a finish), a product with a wood name as its Type, a product with a variant
// title that has a trailing space, and maya-chair-1, which is not published to Switzerland.

import { fieldAlias, type MetaValue, type ProductFacts, type VariantFact } from "../shared/facts";
import { marketStates, type RawMarket } from "../shared/markets";
import { defaultSettings, marketDefs, type BlockSettings } from "../shared/settings";

export const meta = (value: string | null, type = "single_line_text_field"): MetaValue => ({ value, type });
const a = (key: string, ns = "custom") => fieldAlias({ namespace: ns, key });

export function variant(over: Partial<VariantFact> = {}): VariantFact {
  return { id: "gid://shopify/ProductVariant/1", title: "Oak / 180", selectedOptions: [{ name: "Wood", value: "Oak" }, { name: "Length", value: "180" }], price: 1200, compareAt: 1500, sku: "TBL-OAK-180", weight: 40, cost: 500, hasImage: true, fields: { [a("variant_length")]: meta("180"), [a("variant_table_person_space")]: meta("6") }, ...over };
}

/** A finished real product: everything the default settings ask for is in place. */
export function realProduct(over: Partial<ProductFacts> = {}): ProductFacts {
  const base: ProductFacts = {
    id: "gid://shopify/Product/9001",
    numericId: "9001",
    handle: "maya-dining-table",
    title: "Maya Dining Table",
    status: "ACTIVE",
    productType: "Tables",
    tags: ["dining"],
    category: "Tables",
    description: "A solid oak dining table made to order in our workshop with a choice of finishes and edges.",
    bodyWords: 17,
    seoTitle: "Maya Dining Table | Hardman Design",
    seoDescription: "Solid oak dining table, made to order in the UK. Choose the length, finish and edge that suit your home and your family.",
    images: [1, 2, 3].map((i) => ({ id: `gid://shopify/MediaImage/${i}`, alt: `Maya table view ${i}` })),
    imagesTruncated: false,
    options: [{ name: "Wood", values: ["Oak", "Walnut"] }, { name: "Length", values: ["180", "200"] }],
    variants: [variant(), variant({ id: "gid://shopify/ProductVariant/2", title: "Oak / 200", sku: "TBL-OAK-200" })],
    variantsTruncated: false,
    fields: {
      [a("tag_line")]: meta("Made to be shared"),
      [a("product_wood_type")]: meta("Oak"),
      [a("material-main-title")]: meta("Oak"),
      [a("hd_related_products")]: meta("maya-chair-1"),
      [a("hd_recommended_products")]: meta("maya-bench"),
      [a("stock_delivery")]: meta("Made to order, 6 to 8 weeks"),
      [a("design_customisation")]: meta("gid://shopify/Metaobject/1", "metaobject_reference"),
      [a("required_options")]: meta(null),
      [fieldAlias({ namespace: "seo", key: "hidden" })]: meta(null),
    },
    publishedCatalogIds: ["cat_uk", "cat_us", "cat_fr", "cat_de", "cat_nl", "cat_ch"],
    duplicates: [],
    linked: {
      [a("hd_related_products")]: [{ token: "maya-chair-1", handle: "maya-chair-1", found: true, status: "ACTIVE", published: true, self: false }],
      [a("hd_recommended_products")]: [{ token: "maya-bench", handle: "maya-bench", found: true, status: "ACTIVE", published: true, self: false }],
    },
    read: { content: "ok", media: "ok", variants: "ok", variantExtras: "ok", publications: "ok", duplicates: "ok", linked: "ok" },
    notes: [],
  };
  return { ...base, ...over };
}

/** A finish used by the theme as an option. No SEO, one image, no theme fields: it must not be nagged. */
export function helperProduct(over: Partial<ProductFacts> = {}): ProductFacts {
  return realProduct({
    id: "gid://shopify/Product/9002",
    numericId: "9002",
    handle: "light-oak-finish",
    title: "Light Oak Finish",
    productType: "Finishes",
    category: null,
    tags: [],
    description: "",
    bodyWords: 0,
    seoTitle: "",
    seoDescription: "",
    images: [],
    fields: {},
    linked: {},
    variants: [variant({ title: "Default Title", sku: "FIN-LO", weight: 0, cost: null, hasImage: false })],
    options: [],
    ...over,
  });
}

export const RAW_MARKETS: RawMarket[] = [
  ["uk", "United Kingdom", "GB"],
  ["us", "United States", "US"],
  ["fr", "France", "FR"],
  ["de", "Germany", "DE"],
  ["nl", "Netherlands", "NL"],
  ["ch", "Switzerland", "CH"],
].map(([id, name, code]) => ({ id: `gid://shopify/Market/${id}`, name: name!, handle: id!, status: "ACTIVE", catalogs: { nodes: [{ id: `cat_${id}` }] }, conditions: { regionsCondition: { regions: { nodes: [{ __typename: "MarketRegionCountry", code }] } } } }));

export const marketsFor = (published: string[], settings: BlockSettings = defaultSettings()) => marketStates(marketDefs(settings), RAW_MARKETS, published);
