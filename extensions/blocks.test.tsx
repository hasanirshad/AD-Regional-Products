import { describe, expect, it } from "vitest";
import { render as html } from "preact-render-to-string";
import { fakeShopify, gqlError, type Handler } from "./testkit/fake";
import { BlockError, makeQueries, type LoadContext } from "./shared/graphql";
import { BlockView, type BlockConfig } from "./shared/ui";
import { MARKETS } from "./shared/constants";

import * as market from "./market-availability/src/logic";
import { View as MarketView } from "./market-availability/src/Block";
import * as translation from "./translation-status/src/logic";
import { View as TranslationView } from "./translation-status/src/Block";
import * as sale from "./sale-badge/src/logic";
import { View as SaleView } from "./sale-badge/src/Block";
import * as quality from "./data-quality/src/logic";
import { View as QualityView } from "./data-quality/src/Block";
import * as collections from "./collections-tags/src/logic";
import { View as CollectionsView } from "./collections-tags/src/Block";
import * as links from "./quick-links/src/logic";
import { View as LinksView } from "./quick-links/src/Block";
import * as activity from "./recent-activity/src/logic";
import { View as ActivityView } from "./recent-activity/src/Block";

const PRODUCT = "gid://shopify/Product/111";
const money = (amount: string, currencyCode: string) => ({ amount, currencyCode });
const CUR: Record<string, string> = { FR: "EUR", DE: "EUR", NL: "EUR", CH: "CHF", GB: "GBP", US: "USD" };

/** Pricing aliases for every market: [price, compareAt] for the cheapest and the dearest variant. */
function pricing(over: Record<string, { low: [string, string | null]; high: [string, string | null] }> = {}) {
  const out: Record<string, unknown> = {};
  for (const m of MARKETS) {
    const p = over[m.country] ?? { low: ["1000", null], high: ["2000", null] };
    const q = (v: [string, string | null]) => ({ price: money(v[0], CUR[m.country]!), compareAtPrice: v[1] ? money(v[1], CUR[m.country]!) : null });
    out[`p_${m.country}`] = { minVariantPricing: q(p.low), maxVariantPricing: q(p.high) };
  }
  return out;
}

const region = (code: string) => ({ conditions: { regionsCondition: { regions: { nodes: [{ __typename: "MarketRegionCountry", code }] } } } });
const marketNode = (id: string, name: string, handle: string, code: string, status = "ACTIVE") => ({ id, name, handle, status, catalogs: { nodes: [{ id: `cat_${id}`, title: name }] }, ...region(code) });
const GLOBAL = { id: "m_global", name: "Global", handle: "de", status: "ACTIVE", catalogs: { nodes: [{ id: "cat_global" }] }, conditions: { regionsCondition: { regions: { nodes: ["FR", "DE", "NL", "CH", "GB", "US"].map((code) => ({ __typename: "MarketRegionCountry", code })) } } } };
const ALL_MARKETS = [GLOBAL, marketNode("fr", "France", "fr", "FR"), marketNode("de", "Germany", "germany", "DE"), marketNode("nl", "Netherlands", "nl", "NL"), marketNode("ch", "Switzerland", "ch", "CH"), marketNode("uk", "United Kingdom", "uk", "GB"), marketNode("us", "United States", "us", "US")];
const published = (...ids: string[]) => ({ nodes: ids.map((id) => ({ publication: { catalog: { id } } })) });

async function run<T>(handlers: Record<string, Handler>, load: (c: LoadContext) => Promise<T>) {
  const fake = fakeShopify(handlers);
  const { q, soft } = makeQueries(fake.raw, async () => {});
  const data = await load({ productId: PRODUCT, q, soft });
  return { data, seen: fake.seen };
}

describe("Market Availability", () => {
  it("shows a published market, an unpublished one, and prices", async () => {
    const { data } = await run(
      { MarketAvailability: () => ({ product: { id: PRODUCT, status: "ACTIVE", resourcePublicationsV2: published("cat_fr", "cat_de", "cat_nl", "cat_uk", "cat_us", "cat_global"), ...pricing({ GB: { low: ["900", "1200"], high: ["1800", "2400"] } }) }, markets: { nodes: ALL_MARKETS } }) },
      market.load,
    );
    expect(Object.fromEntries(data.rows.map((r) => [r.def.key, r.state]))).toEqual({ FR: "published", DE: "published", NL: "published", CH: "not-published", UK: "published", US: "published" });
    const out = html(<MarketView data={data} />);
    expect(out).toContain("Not published in CH");
    expect(out).toContain("Not published");
    expect(out).toMatch(/900/);
    expect(out).toMatch(/2,?400/);
  });

  it("ignores the hidden Global market: a product only in Global is not published anywhere", async () => {
    const { data } = await run({ MarketAvailability: () => ({ product: { id: PRODUCT, status: "ACTIVE", resourcePublicationsV2: published("cat_global"), ...pricing() }, markets: { nodes: ALL_MARKETS } }) }, market.load);
    expect(data.rows.every((r) => r.state === "not-published")).toBe(true);
  });

  it("says when a market cannot be found, and warns for a draft product", async () => {
    const { data } = await run(
      { MarketAvailability: () => ({ product: { id: PRODUCT, status: "DRAFT", resourcePublicationsV2: published("cat_fr"), ...pricing() }, markets: { nodes: ALL_MARKETS.filter((m) => m.id !== "uk") } }) },
      market.load,
    );
    expect(data.rows.find((r) => r.def.key === "UK")?.state).toBe("no-market");
    const out = html(<MarketView data={data} />);
    expect(out).toContain("Market not found");
    expect(out).toContain("Product is draft");
  });

  it("shows an inactive market and works without prices", async () => {
    const markets = ALL_MARKETS.map((m) => (m.id === "fr" ? { ...m, status: "DRAFT" } : m));
    const { data } = await run({ MarketAvailability: () => ({ product: { id: PRODUCT, status: "ACTIVE", resourcePublicationsV2: published("cat_fr") }, markets: { nodes: markets } }) }, market.load);
    const out = html(<MarketView data={data} />);
    expect(out).toContain("Market draft");
    expect(out).toContain("No price");
  });
});

describe("Translation Status", () => {
  const content = [
    { key: "title", value: "Oak table" },
    { key: "body_html", value: "<p>Solid oak</p>" },
    { key: "meta_title", value: "Oak table | Hardman" },
    { key: "handle", value: "oak-table" },
  ];
  const base = {
    product: {
      id: PRODUCT,
      options: [{ id: "opt1", name: "Size", optionValues: [{ id: "val1", name: "Small" }, { id: "val2", name: "Large" }] }],
      ns0: { nodes: [{ id: "mf1", namespace: "custom", key: "care" }, { id: "mf2", namespace: "custom", key: "count" }] },
    },
    translatableResource: {
      translatableContent: content,
      tr_fr: [{ key: "title", value: "Table en chêne", outdated: false }, { key: "body_html", value: "<p>Chêne massif</p>", outdated: true }, { key: "meta_title", value: "Table | Hardman" }, { key: "handle", value: "table-chene" }],
      tr_de: [{ key: "title", value: "Oak table" }, { key: "body_html", value: "<p>Massivholz</p>" }],
      tr_nl: [],
    },
  };
  const nested = {
    translatableResourcesByIds: {
      nodes: [
        { resourceId: "opt1", translatableContent: [{ key: "name", value: "Size" }], tr_fr: [{ key: "name", value: "Taille" }], tr_de: [{ key: "name", value: "Size" }], tr_nl: [] },
        { resourceId: "val1", translatableContent: [{ key: "name", value: "Small" }], tr_fr: [{ key: "name", value: "Petit" }], tr_de: [{ key: "name", value: "Klein" }], tr_nl: [] },
        { resourceId: "val2", translatableContent: [{ key: "name", value: "Large" }], tr_fr: [{ key: "name", value: "Large" }], tr_de: [{ key: "name", value: "Gross" }], tr_nl: [] },
        { resourceId: "mf1", translatableContent: [{ key: "value", value: "Wipe clean" }], tr_fr: [{ key: "value", value: "Essuyer" }], tr_de: [], tr_nl: [] },
        { resourceId: "mf2", translatableContent: [], tr_fr: [], tr_de: [], tr_nl: [] },
      ],
    },
  };
  const handlers = { TranslationBase: () => base, TranslationNested: () => nested };

  it("works out translated / missing / same per field and language", async () => {
    const { data } = await run(handlers, translation.load);
    const row = (key: string) => data.rows.find((r) => r.key === key)!;
    expect(row("title").cells.fr!.status).toBe("translated");
    expect(row("title").cells.de!.status).toBe("same");
    expect(row("title").cells.nl!.status).toBe("missing");
    expect(row("body_html").cells.fr).toMatchObject({ status: "translated", outdated: true });
    expect(data.rows.find((r) => r.key === "meta_description")).toBeUndefined();
    expect(row("mf:mf1").cells.fr!.status).toBe("translated");
    expect(row("mf:mf1").cells.de!.status).toBe("missing");
    expect(data.rows.find((r) => r.key === "mf:mf2")).toBeUndefined();
    expect(row("opt:opt1").cells.de!.status).toBe("same");
    const values = row("optv:opt1");
    expect(values.cells.fr).toMatchObject({ status: "same", counts: { total: 2, same: 1, translated: 1, missing: 0 } });
    expect(values.cells.de!.status).toBe("translated");
    expect(values.cells.nl!.status).toBe("missing");
    expect(data.totals.nl!.translated).toBe(0);
  });

  it("renders the table", async () => {
    const { data } = await run(handlers, translation.load);
    const out = html(<TranslationView data={data} />);
    for (const word of ["Translated", "Missing", "Same as source", "(outdated)", "Option values: Size", "custom.care", "Handle (URL)"]) expect(out).toContain(word);
  });

  it("asks for ids in one request and skips the second when there is nothing nested", async () => {
    const lonely = { ...base, product: { id: PRODUCT, options: [], ns0: { nodes: [] } } };
    const { seen } = await run({ TranslationBase: () => lonely }, translation.load);
    expect(seen.map((s) => s.name)).toEqual(["TranslationBase"]);
    const both = await run(handlers, translation.load);
    expect(both.seen.map((s) => s.name)).toEqual(["TranslationBase", "TranslationNested"]);
    expect(both.seen[1]!.vars.ids).toEqual(["opt1", "val1", "val2", "mf1", "mf2"]);
  });

  it("shows a plain message when the translations permission is missing", async () => {
    const fake = fakeShopify({ TranslationBase: () => gqlError("Access denied for translatableResource field. Required access: `read_translations` access scope.", "ACCESS_DENIED") });
    const { q, soft } = makeQueries(fake.raw, async () => {});
    const err = (await translation.load({ productId: PRODUCT, q, soft }).catch((e: unknown) => e)) as BlockError;
    expect(err.message).toContain("read_translations");
  });
});

describe("Sale and Badge", () => {
  const collectionsPage = (handles: string[], hasNext = false, endCursor: string | null = null) => ({ nodes: handles.map((h) => ({ id: `gid://shopify/Collection/${h}`, title: h, handle: h, ruleSet: null })), pageInfo: { hasNextPage: hasNext, endCursor } });
  const saleProduct = (extra: Record<string, unknown> = {}) => ({
    product: {
      id: PRODUCT,
      badge: { id: "mf_badge", value: "Sale" },
      collections: collectionsPage(["new", "sale"]),
      ...pricing({ FR: { low: ["800", "1000"], high: ["1600", "2000"] }, GB: { low: ["700", "1000"], high: ["1700", "1900"] } }),
      ...extra,
    },
  });
  const badgeTr = { translatableResource: { translatableContent: [{ key: "value", value: "Sale" }], tr_fr: [{ key: "value", value: "Soldes" }], tr_de: [{ key: "value", value: "Sale" }], tr_nl: [] } };

  it("calculates discounts per market and reads the badge translations", async () => {
    const { data } = await run({ SaleBadge: () => saleProduct(), BadgeTranslations: () => badgeTr }, sale.load);
    const fr = data.rows.find((r) => r.def.key === "FR")!;
    expect(fr.discounts).toEqual([20, 20]);
    expect(data.rows.find((r) => r.def.key === "UK")!.discounts).toEqual([30, 11]);
    expect(data.rows.find((r) => r.def.key === "DE")!.onSale).toBe(false);
    expect(data.inSaleCollection).toBe(true);
    expect(data.badge.translations).toMatchObject({ fr: { status: "translated" }, de: { status: "same" }, nl: { status: "missing" } });
    const out = html(<SaleView data={data} />);
    expect(out).toContain("20% off");
    expect(out).toContain("11–30% off");
    expect(out).toContain("Sale prices exist in FR, UK only.");
    expect(out).toContain("Translated");
  });

  it("warns when the product is on sale but not in the sale collection and has no badge", async () => {
    const { data } = await run({ SaleBadge: () => saleProduct({ badge: null, collections: collectionsPage(["new"]) }) }, sale.load);
    const out = html(<SaleView data={data} />);
    expect(out).toContain("not in the &quot;sale&quot; collection");
    expect(out).toContain("badge is empty");
  });

  it("finds the sale collection on a later page of collections", async () => {
    const pages: Record<string, ReturnType<typeof collectionsPage>> = { c1: collectionsPage(["sale"]) };
    const { data } = await run(
      {
        SaleBadge: () => saleProduct({ collections: collectionsPage(["a"], true, "c1"), badge: null }),
        MoreCollections: (v) => ({ product: { collections: pages[v.after as string] } }),
      },
      sale.load,
    );
    expect(data.inSaleCollection).toBe(true);
    expect(data.collectionsComplete).toBe(true);
  });

  it("still shows prices when the badge translations cannot be read", async () => {
    const { data } = await run({ SaleBadge: () => saleProduct(), BadgeTranslations: () => gqlError("Access denied for translatableResource field. Required access: `read_translations` access scope.", "ACCESS_DENIED") }, sale.load);
    expect(data.badge.translations).toBeNull();
    const out = html(<SaleView data={data} />);
    expect(out).toContain("Translations could not be read");
    expect(out).toContain("20% off");
  });
});

describe("Data Quality", () => {
  const variant = (over: Record<string, unknown> = {}) => ({ id: "v", title: "Small / Oak", price: "100.00", selectedOptions: [{ name: "Size", value: "Small" }, { name: "Wood", value: "Oak" }], m_custom_variant_length: { value: "180" }, m_custom_variant_table_person_space: { value: "6" }, ...over });
  const good = () => ({
    id: PRODUCT,
    status: "ACTIVE",
    seo: { title: "Oak table", description: "Solid oak" },
    media: { nodes: [{ alt: "Oak table", mediaContentType: "IMAGE" }], pageInfo: { hasNextPage: false } },
    resourcePublicationsV2: { nodes: [{ publication: { id: "p" } }] },
    variants: { nodes: [variant()], pageInfo: { hasNextPage: false, endCursor: null } },
  });

  it("passes a clean product (lead time is not configured, so 7 of 7)", () => {
    const d = quality.evaluate(good() as never, good().variants.nodes as never);
    expect(d.counted).toBe(7);
    expect(d.passed).toBe(7);
    expect(d.checks.find((c) => c.id === "lead")).toMatchObject({ status: "skipped" });
    expect(html(<QualityView data={d} />)).toContain("7 of 7 passed");
  });

  it("fails each check with a reason", () => {
    const p = { ...good(), seo: { title: "", description: null }, media: { nodes: [{ alt: "", mediaContentType: "IMAGE" }, { alt: "ok", mediaContentType: "IMAGE" }], pageInfo: { hasNextPage: false } }, resourcePublicationsV2: { nodes: [] } };
    const variants = [variant({ title: " Small / Oak", m_custom_variant_length: null }), variant({ price: "0.00", m_custom_variant_table_person_space: { value: "  " } })];
    const d = quality.evaluate(p as never, variants as never);
    const byId = Object.fromEntries(d.checks.map((c) => [c.id, c]));
    expect(byId.alt!.reason).toBe("1 of 2 images has no alt text.");
    expect(byId.spaces!.reason).toContain('" Small / Oak"');
    expect(byId.lengthSeater!.reason).toBe("Length is empty on 1 of 2 variants; Seater is empty on 1 of 2 variants.");
    expect(byId.seo!.reason).toBe("SEO title and SEO description not set.");
    expect(byId.price!.reason).toBe("1 variant priced at 0 or less.");
    expect(byId.market!.status).toBe("fail");
    expect(byId.image!.status).toBe("pass");
    expect(d.passed).toBe(1);
    const out = html(<QualityView data={d} />);
    expect(out).toContain("1 of 7 passed");
    expect(out).toContain("Not configured");
  });

  it("flags a product with no images, and with option values that have spaces", () => {
    const p = { ...good(), media: { nodes: [], pageInfo: { hasNextPage: false } } };
    const v = variant({ selectedOptions: [{ name: "Wood", value: "Oak " }] });
    const d = quality.evaluate(p as never, [v] as never);
    expect(d.checks.find((c) => c.id === "image")!.status).toBe("fail");
    expect(d.checks.find((c) => c.id === "alt")!.reason).toMatch(/No images/);
    expect(d.checks.find((c) => c.id === "spaces")!.status).toBe("fail");
  });

  it("reads further pages of variants and notes a cap", async () => {
    const first = { ...good(), variants: { nodes: [variant({ id: "a" })], pageInfo: { hasNextPage: true, endCursor: "c1" } } };
    const { data, seen } = await run(
      {
        Quality: () => ({ product: first }),
        QualityVariants: (v) => ({ product: { variants: v.after === "c1" ? { nodes: [variant({ id: "b", price: "0" })], pageInfo: { hasNextPage: false, endCursor: null } } : { nodes: [], pageInfo: { hasNextPage: false } } } }),
      },
      quality.load,
    );
    expect(seen.map((s) => s.name)).toEqual(["Quality", "QualityVariants"]);
    expect(data.checks.find((c) => c.id === "price")!.reason).toBe("1 variant priced at 0 or less.");
  });

  it("asks for the metafields named in the constants", async () => {
    const { seen } = await run({ Quality: () => ({ product: good() }) }, quality.load);
    expect(seen[0]!.query).toContain('metafield(namespace: "custom", key: "variant_length")');
    expect(seen[0]!.query).toContain('metafield(namespace: "custom", key: "variant_table_person_space")');
  });
});

describe("Collections and Tags", () => {
  it("lists collections with type and admin links, and sorted tags", async () => {
    const { data } = await run(
      {
        CollectionsTags: () => ({
          shop: { myshopifyDomain: "hardman.myshopify.com" },
          product: {
            tags: ["new_stock", "b2b"],
            collections: { nodes: [{ id: "gid://shopify/Collection/22", title: "Tables", handle: "tables", ruleSet: { appliedDisjunctively: false } }, { id: "gid://shopify/Collection/11", title: "Best sellers", handle: "best", ruleSet: null }], pageInfo: { hasNextPage: false } },
          },
        }),
      },
      collections.load,
    );
    expect(data.collections.map((c) => [c.title, c.automated])).toEqual([["Best sellers", false], ["Tables", true]]);
    expect(data.collections[0]!.url).toBe("https://admin.shopify.com/store/hardman/collections/11");
    expect(data.tags).toEqual(["b2b", "new_stock"]);
    const out = html(<CollectionsView data={data} />);
    expect(out).toContain("Automated");
    expect(out).toContain("Manual");
    expect(out).toContain("new_stock");
    expect(out).toContain('href="https://admin.shopify.com/store/hardman/collections/22"');
  });

  it("says plainly when there are none", () => {
    const out = html(<CollectionsView data={{ collections: [], tags: [], complete: true }} />);
    expect(out).toContain("Not in any collection.");
    expect(out).toContain("No tags.");
  });
});

describe("Quick Links", () => {
  it("builds a link per market, stay_us on the US one, the preview theme and the orders filter", () => {
    const d = links.buildLinks({ handle: "oak-table", status: "ACTIVE", shop: "hardman", productId: PRODUCT, themeId: "1234567890", previewKey: "US" });
    expect(d.storefront.find((l) => l.key === "US")!.url).toBe("https://hardmandesign.com/products/oak-table?stay_us=1");
    expect(d.storefront.find((l) => l.key === "FR")!.url).toBe("https://hardmandesign.fr/products/oak-table");
    expect(d.preview!.url).toBe("https://hardmandesign.com/products/oak-table?preview_theme_id=1234567890&stay_us=1");
    expect(d.orders.url).toBe("https://admin.shopify.com/store/hardman/orders?query=product_id%3A111");
    const out = html(<LinksView data={d} />);
    expect(out).toContain("hardmandesign.de/products/oak-table");
  });

  it("hides the preview link until a theme id is set", () => {
    const d = links.buildLinks({ handle: "x", status: "DRAFT", shop: "hardman", productId: PRODUCT, themeId: "" });
    expect(d.preview).toBeNull();
    const out = html(<LinksView data={d} />);
    expect(out).toContain("PREVIEW_THEME_ID");
    expect(out).toContain("Product is draft");
  });

  it("reads handle and status in one request", async () => {
    const { data, seen } = await run({ QuickLinks: () => ({ shop: { myshopifyDomain: "hardman.myshopify.com" }, product: { handle: "oak-table", status: "ACTIVE" } }) }, links.load);
    expect(seen).toHaveLength(1);
    expect(data.adminProduct).toBe("https://admin.shopify.com/store/hardman/products/111");
  });
});

describe("Recent Activity", () => {
  it("lists the newest events first with who made them, and says price changes are not listed", async () => {
    const { data, seen } = await run(
      {
        RecentActivity: () => ({
          product: {
            updatedAt: "2026-10-27T10:00:00Z",
            events: {
              nodes: [
                { id: "1", createdAt: "2026-10-25T08:00:00Z", message: "Product was created.", action: "create", attributeToUser: true, attributeToApp: false },
                { id: "2", createdAt: "2026-10-27T09:00:00Z", message: '<a href="/x">Hardman</a> published this &amp; that', action: "published", appTitle: "AD Metafields", attributeToApp: true, attributeToUser: false },
                { id: "3", createdAt: "2026-10-26T09:00:00Z", message: "", action: "update", attributeToApp: false, attributeToUser: false },
              ],
            },
          },
        }),
      },
      activity.load,
    );
    expect(data.events.map((e) => e.id)).toEqual(["2", "3", "1"]);
    expect(data.events[0]).toMatchObject({ text: "Hardman published this & that", who: "App: AD Metafields" });
    expect(data.events[1]).toMatchObject({ text: "update", who: "Shopify" });
    expect(data.events[2]!.who).toBe("A staff member");
    expect(seen[0]!.vars.first).toBe(20);
    const out = html(<ActivityView data={data} />);
    expect(out).toContain("Price changes are not listed");
  });

  it("names an app acting for a staff member", () => {
    expect(activity.whoDidIt({ appTitle: "Flow", attributeToApp: true, attributeToUser: true })).toBe("App: Flow (for a staff member)");
    expect(activity.whoDidIt({ attributeToApp: true })).toBe("An app");
  });
});

describe("shared block frame", () => {
  const cfg: BlockConfig<{ n: number }> = { heading: "Test block", load: async () => ({ n: 1 }), summary: (d) => `${d.n} thing`, empty: (d) => (d.n ? null : "Nothing here."), View: ({ data }) => <s-text>Got {data.n}</s-text> };

  it("shows loading, error, empty and data", () => {
    expect(html(<BlockView cfg={cfg} state={{ kind: "loading" }} />)).toContain("Loading");
    const err = html(<BlockView cfg={cfg} state={{ kind: "error", error: new BlockError("network", "Could not reach Shopify.") }} />);
    expect(err).toContain("Could not reach Shopify.");
    expect(err).toContain("This block could not load");
    expect(html(<BlockView cfg={cfg} state={{ kind: "ready", data: { n: 0 } }} />)).toContain("Nothing here.");
    const ok = html(<BlockView cfg={cfg} state={{ kind: "ready", data: { n: 3 } }} />);
    expect(ok).toContain("Got 3");
    expect(ok).toContain("3 thing");
  });
});

describe("read only", () => {
  it("no block sends a mutation", async () => {
    const all: string[] = [];
    const record = async <T,>(handlers: Record<string, Handler>, load: (c: LoadContext) => Promise<T>) => {
      const { seen } = await run(handlers, load).catch(() => ({ seen: [] as { query: string }[] }));
      all.push(...seen.map((s) => s.query));
    };
    await record({ MarketAvailability: () => ({ product: { id: PRODUCT, status: "ACTIVE" }, markets: { nodes: [] } }) }, market.load);
    await record({ TranslationBase: () => ({ product: { id: PRODUCT, options: [], ns0: { nodes: [] } }, translatableResource: { translatableContent: [] } }) }, translation.load);
    await record({ SaleBadge: () => ({ product: { id: PRODUCT, badge: null, collections: { nodes: [], pageInfo: { hasNextPage: false } } } }) }, sale.load);
    await record({ Quality: () => ({ product: { id: PRODUCT, status: "ACTIVE", media: { nodes: [], pageInfo: { hasNextPage: false } }, variants: { nodes: [], pageInfo: { hasNextPage: false } } } }) }, quality.load);
    await record({ CollectionsTags: () => ({ shop: { myshopifyDomain: "x.myshopify.com" }, product: { tags: [], collections: { nodes: [], pageInfo: { hasNextPage: false } } } }) }, collections.load);
    await record({ QuickLinks: () => ({ shop: { myshopifyDomain: "x.myshopify.com" }, product: { handle: "h", status: "ACTIVE" } }) }, links.load);
    await record({ RecentActivity: () => ({ product: { updatedAt: "2026-10-27T00:00:00Z", events: { nodes: [] } } }) }, activity.load);
    expect(all.length).toBeGreaterThanOrEqual(7);
    for (const q of all) expect(q).not.toMatch(/\bmutation\b/i);
  });
});
