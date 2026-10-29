import { describe, expect, it } from "vitest";
import { render as html } from "preact-render-to-string";
import { fakeShopify, gqlError, type Handler } from "./testkit/fake";
import { RAW_MARKETS } from "./testkit/health";
import { makeQueries, type LoadContext } from "./shared/graphql";
import { defaultSettings, type BlockSettings } from "./shared/settings";
import { MARKETS } from "./shared/constants";

import * as health from "./product-health/src/logic";
import { View as HealthView } from "./product-health/src/Block";
import * as quality from "./data-quality/src/logic";
import { View as QualityView } from "./data-quality/src/Block";
import * as ready from "./storefront-readiness/src/logic";
import { View as ReadyView } from "./storefront-readiness/src/Block";
import * as options from "./options-swatches/src/logic";
import { View as OptionsView } from "./options-swatches/src/Block";
import * as snapshot from "./content-snapshot/src/logic";
import { View as SnapshotView, bar } from "./content-snapshot/src/Block";
import * as market from "./market-availability/src/logic";
import { loadFacts } from "./shared/facts";
import { MARKETS_SELECTION } from "./shared/markets";

const PRODUCT = "gid://shopify/Product/9001";
const GOOD_BODY = "A solid oak dining table made to order in our workshop with a choice of finishes and edges.";
const meta = (value: string | null, type = "single_line_text_field") => (value === null ? null : { value, type });

const rawVariant = (n: number, over: Record<string, unknown> = {}) => ({
  id: `gid://shopify/ProductVariant/${n}`,
  title: `Oak / ${n}`,
  price: "1200.00",
  compareAtPrice: "1500.00",
  selectedOptions: [{ name: "Wood", value: "Oak" }, { name: "Length", value: String(n) }],
  sku: `SKU-${n}`,
  media: { nodes: [{ id: "m1" }] },
  inventoryItem: { unitCost: { amount: "500.0" }, measurement: { weight: { value: 40, unit: "KILOGRAMS" } } },
  m_custom_variant_length: meta("180"),
  m_custom_variant_table_person_space: meta("6"),
  ...over,
});

const rawProduct = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT,
  handle: "maya-dining-table",
  title: "Maya Dining Table",
  status: "ACTIVE",
  productType: "Tables",
  tags: [],
  category: { name: "Tables" },
  description: GOOD_BODY,
  seo: { title: "Maya Dining Table | Hardman Design", description: "Solid oak dining table, made to order in the UK. Choose the length, finish and edge that suit your home." },
  options: [{ name: "Wood", values: ["Oak"] }, { name: "Length", values: ["180", "200"] }],
  media: { nodes: [{ id: "i1", alt: "Front", mediaContentType: "IMAGE" }, { id: "i2", alt: "Side", mediaContentType: "IMAGE" }], pageInfo: { hasNextPage: false, endCursor: null } },
  resourcePublicationsV2: { nodes: RAW_MARKETS.map((m) => ({ publication: { catalog: { id: m.catalogs!.nodes[0]!.id } } })) },
  m_custom_tag_line: meta("Made to be shared"),
  m_custom_product_wood_type: meta("Oak"),
  m_custom_material_main_title: meta("Oak"),
  m_custom_hd_related_products: meta("maya-chair-1"),
  m_custom_hd_recommended_products: meta("maya-bench"),
  m_custom_stock_delivery: meta("6 to 8 weeks"),
  m_custom_design_customisation: meta("Yes"),
  m_custom_required_options: null,
  m_seo_hidden: null,
  variants: { nodes: [rawVariant(180), rawVariant(200)], pageInfo: { hasNextPage: false, endCursor: null } },
  ...over,
});

const linkedAnswer = { nodes: [], products: { nodes: [{ id: "p2", handle: "maya-chair-1", status: "ACTIVE", resourcePublicationsV2: { nodes: [{ __typename: "x" }] } }, { id: "p3", handle: "maya-bench", status: "ACTIVE", resourcePublicationsV2: { nodes: [{ __typename: "x" }] } }] } };
const marketsAnswer = { markets: { nodes: RAW_MARKETS } };

const baseHandlers = (product = rawProduct()): Record<string, Handler> => ({
  FactsProduct: () => ({ product }),
  FactsTitles: () => ({ products: { nodes: [{ id: PRODUCT, handle: "maya-dining-table", title: "Maya Dining Table" }] } }),
  FactsLinked: () => linkedAnswer,
  FactsMarkets: () => marketsAnswer,
  FactsDelivery: () => ({ metaobjects: { nodes: [{ id: "gid://shopify/Metaobject/9", type: "build_and_delivery_time", handle: "oak", displayName: "Oak", capabilities: { publishable: { status: "ACTIVE" } }, fields: [] }] } }),
});

async function run<T>(handlers: Record<string, Handler>, load: (c: LoadContext) => Promise<T>, settings?: BlockSettings) {
  const fake = fakeShopify(handlers);
  const { q, soft } = makeQueries(fake.raw, async () => {});
  const data = await load({ productId: PRODUCT, q, soft, settings });
  return { data, seen: fake.seen };
}

describe("Product health", () => {
  it("a finished product is Ready, and the view says so", async () => {
    const { data } = await run(baseHandlers(), health.load);
    const r = health.reportOf(data);
    expect(r.verdict).toBe("Ready");
    expect(r.score).toBe(100);
    const out = html(<HealthView data={data} />);
    expect(out).toContain("Ready");
    expect(out).toContain("100 / 100");
    expect(out).toContain("Nothing is pending.");
    expect(health.summaryOf(r)).toBe("100/100 · Ready");
  });

  it("asks for what it needs in a few requests, not one per check", async () => {
    const { seen } = await run(baseHandlers(), health.load);
    expect(seen.map((s) => s.name).sort()).toEqual(["FactsDelivery", "FactsLinked", "FactsMarkets", "FactsProduct", "FactsTitles"]);
    const main = seen.find((s) => s.name === "FactsProduct")!.query;
    expect(main).toContain('metafield(namespace: "custom", key: "tag_line")');
    expect(main).toContain('metafield(namespace: "seo", key: "hidden")');
    expect(main).toContain("inventoryItem");
  });

  it("lists what is pending, grouped by severity, with the field and a link", async () => {
    const product = rawProduct({ seo: { title: "", description: "" }, resourcePublicationsV2: { nodes: [] }, variants: { nodes: [rawVariant(180, { sku: "" })], pageInfo: { hasNextPage: false, endCursor: null } } });
    const { data } = await run(baseHandlers(product), health.load);
    const r = health.reportOf(data);
    expect(r.counts).toEqual({ blocks: 1, hurts: 2, nice: 1 });
    const out = html(<HealthView data={data} />);
    expect(out).toContain("Blocks storefront");
    expect(out).toContain("Hurts SEO or sales");
    expect(out).toContain("SEO description");
    expect(out).toContain("Not in any market catalogue.");
    expect(out).toContain("shopify:admin/products/9001#seo");
    expect(out).toContain("3 to fix before launch");
  });

  it("collapses to the top five and offers Show all", async () => {
    const product = rawProduct({ seo: { title: "", description: "" }, description: "", media: { nodes: [], pageInfo: { hasNextPage: false } }, productType: "Ash", m_custom_tag_line: null, m_custom_stock_delivery: null, resourcePublicationsV2: { nodes: [] } });
    const { data } = await run(baseHandlers(product), health.load);
    const r = health.reportOf(data);
    const pending = r.pending.blocks.length + r.pending.hurts.length + r.pending.nice.length;
    expect(pending).toBeGreaterThan(5);
    expect(html(<HealthView data={data} />)).toContain(`Show all ${pending}`);
  });

  it("an option product is not nagged for SEO or images, and says it is an option product", async () => {
    const product = rawProduct({ productType: "Finishes", seo: { title: "", description: "" }, description: "", media: { nodes: [], pageInfo: { hasNextPage: false } } });
    const { data } = await run(baseHandlers(product), health.load);
    const r = health.reportOf(data);
    expect(r.profile).toBe("option");
    expect(r.results.some((x) => x.group === "seo" || x.group === "images")).toBe(false);
    expect(html(<HealthView data={data} />)).toContain("Option product");
  });

  it("looks up duplicate titles, related products, and reports a missing one", async () => {
    const handlers = baseHandlers();
    handlers.FactsTitles = () => ({ products: { nodes: [{ id: PRODUCT, handle: "maya-dining-table", title: "Maya Dining Table" }, { id: "x", handle: "maya-table-copy", title: "Maya  Dining Table " }] } });
    handlers.FactsLinked = () => ({ nodes: [], products: { nodes: [{ id: "p3", handle: "maya-bench", status: "ACTIVE", resourcePublicationsV2: { nodes: [{ __typename: "x" }] } }] } });
    const { data, seen } = await run(handlers, health.load);
    const r = health.reportOf(data);
    expect(r.results.find((x) => x.id === "basics.duplicateTitle")?.reason).toBe("Same title as 1 other product: maya-table-copy.");
    expect(r.results.find((x) => x.id === "theme:tf:custom.hd_related_products")?.reason).toBe("maya-chair-1 does not exist.");
    const linked = seen.find((s) => s.name === "FactsLinked")!;
    expect(linked.vars.q).toBe("handle:maya-chair-1 OR handle:maya-bench");
    expect(seen.find((s) => s.name === "FactsTitles")!.vars.q).toBe('title:"Maya Dining Table"');
  });

  it("works out the details it cannot read: variant extras refused -> asked again without them", async () => {
    const handlers = baseHandlers();
    handlers.FactsProduct = (_v, query) => {
      if (query.includes("inventoryItem")) throw new Error("Field 'inventoryItem' doesn't exist on type 'ProductVariant'");
      return { product: rawProduct({ variants: { nodes: [{ ...rawVariant(180), sku: undefined, inventoryItem: undefined, media: undefined }], pageInfo: { hasNextPage: false, endCursor: null } } }) };
    };
    const { data, seen } = await run(handlers, health.load);
    expect(seen.filter((s) => s.name === "FactsProduct")).toHaveLength(2);
    expect(data.facts.read.variantExtras).toBe("failed");
    const r = health.reportOf(data);
    expect(r.results.find((x) => x.id === "variants.sku")?.status).toBe("unknown");
    expect(html(<HealthView data={data} />)).toContain("could not be read");
  });

  it("pages through variants up to 250 and says so", async () => {
    const page = (from: number, n: number, next: boolean) => ({ nodes: Array.from({ length: n }, (_, i) => rawVariant(from + i)), pageInfo: { hasNextPage: next, endCursor: next ? `c${from}` : null } });
    const handlers = baseHandlers(rawProduct({ variants: page(1, 125, true) }));
    handlers.FactsVariants = (v) => ({ product: { variants: v.after === "c1" ? page(126, 125, true) : page(251, 50, false) } });
    const { data, seen } = await run(handlers, health.load);
    expect(data.facts.variants).toHaveLength(250);
    expect(data.facts.variantsTruncated).toBe(true);
    expect(data.notes).toContain("First 250 variants checked.");
    expect(seen.filter((s) => s.name === "FactsVariants")).toHaveLength(1);
  });

  it("pages through images", async () => {
    const page = (from: number, next: boolean) => ({ nodes: Array.from({ length: 50 }, (_, i) => ({ id: `i${from + i}`, alt: "x", mediaContentType: "IMAGE" })), pageInfo: { hasNextPage: next, endCursor: next ? `m${from}` : null } });
    const handlers = baseHandlers(rawProduct({ media: page(0, true) }));
    handlers.FactsMedia = (v) => ({ product: { media: v.after === "m0" ? page(50, false) : page(0, false) } });
    const { data } = await run(handlers, health.load);
    expect(data.facts.images).toHaveLength(100);
  });

  it("a refused metaobject read leaves the rest of the block working", async () => {
    const product = rawProduct({ variants: { nodes: [rawVariant(180, { m_custom_swatches_test: meta("gid://shopify/Metaobject/5", "metaobject_reference") })], pageInfo: { hasNextPage: false, endCursor: null } } });
    const handlers = baseHandlers(product);
    handlers.FactsRecords = () => gqlError("Access denied for metaobjects field. Required access: `read_metaobjects` access scope.", "ACCESS_DENIED");
    handlers.FactsDelivery = () => gqlError("Access denied", "ACCESS_DENIED");
    const { data } = await run(handlers, health.load);
    const r = health.reportOf(data);
    expect(r.results.find((x) => x.id === "linked.swatches")?.status).toBe("unknown");
    expect(r.results.find((x) => x.id === "linked.delivery")?.status).toBe("unknown");
    expect(r.score).toBe(100);
    expect(r.pending.hurts).toEqual([]);
    expect(html(<HealthView data={data} />)).toContain("Linked records could not be read");
  });

  it("reads the settings: a group switched off is not asked for", async () => {
    const s = defaultSettings();
    s.groups.groups.markets = false;
    s.groups.groups.linked = false;
    const { seen } = await run(baseHandlers(), health.load, s);
    expect(seen.map((x) => x.name)).not.toContain("FactsMarkets");
  });
});

describe("Data quality checklist (grouped, the same engine)", () => {
  it("groups the checks and hides what does not apply", async () => {
    const { data } = await run(baseHandlers(rawProduct({ seo: { title: "x".repeat(70), description: "" } })), quality.load);
    const out = html(<QualityView data={data} />);
    for (const word of ["Basics", "SEO", "Images", "Variants and pricing", "Theme fields", "Markets", "passed", "70 characters"]) expect(out).toContain(word);
    const r = quality.reportOf(data);
    expect(r.shown.every((x) => x.status !== "na")).toBe(true);
  });
  it("and agrees with Product health", async () => {
    const product = rawProduct({ description: "" });
    const a = await run(baseHandlers(product), quality.load);
    const b = await run(baseHandlers(product), health.load);
    expect(quality.reportOf(a.data).score).toBe(health.reportOf(b.data).score);
  });
});

describe("Market availability and Storefront readiness share one reader", () => {
  it("never disagree about maya-chair-1 and Switzerland", async () => {
    const publishedNotCH = RAW_MARKETS.filter((m) => m.handle !== "ch").map((m) => ({ publication: { catalog: { id: m.catalogs!.nodes[0]!.id } } }));
    const product = rawProduct({ handle: "maya-chair-1", resourcePublicationsV2: { nodes: publishedNotCH } });
    const handlers: Record<string, Handler> = {
      ...baseHandlers(product),
      ReadinessPricing: () => ({ product: { id: PRODUCT, ...Object.fromEntries(MARKETS.map((m) => [`p_${m.country}`, { minVariantPricing: { price: { amount: "1000", currencyCode: "EUR" }, compareAtPrice: null }, maxVariantPricing: { price: { amount: "1000", currencyCode: "EUR" }, compareAtPrice: null } }])) } }),
      MarketAvailability: () => ({ product: { ...Object.fromEntries(MARKETS.map((m) => [`p_${m.country}`, { minVariantPricing: { price: { amount: "1000", currencyCode: "EUR" }, compareAtPrice: null }, maxVariantPricing: { price: { amount: "1000", currencyCode: "EUR" }, compareAtPrice: null } }])), id: PRODUCT, status: "ACTIVE", resourcePublicationsV2: { nodes: publishedNotCH } }, markets: marketsAnswer.markets }),
      MarketShipping: () => ({ markets: { nodes: [] } }),
      MarketReturns: () => ({ markets: { nodes: [] } }),
      ReadinessTranslations: () => ({ translatableResource: { translatableContent: [], tr_fr: [], tr_de: [], tr_nl: [] } }),
    };
    const a = await run(handlers, ready.load);
    const b = await run(handlers, market.load);
    const readyCH = a.data.rows.find((r) => r.state.def.key === "CH")!;
    const marketCH = b.data.rows.find((r) => r.def.key === "CH")!;
    expect(readyCH.state.state).toBe("not-published");
    expect(marketCH.state).toBe("not-published");
    expect(readyCH.dot).toBe("red");
    for (const row of a.data.rows) expect(row.state.state).toBe(b.data.rows.find((r) => r.def.key === row.state.def.key)!.state);
    expect(MARKETS_SELECTION).toContain("catalogs(first: 10)");
  });
});

describe("Storefront readiness", () => {
  const price = (amount: string) => ({ minVariantPricing: { price: { amount, currencyCode: "EUR" }, compareAtPrice: null }, maxVariantPricing: { price: { amount, currencyCode: "EUR" }, compareAtPrice: null } });
  const pricing = (over: Record<string, string> = {}) => ({ product: { id: PRODUCT, ...Object.fromEntries(MARKETS.map((m) => [`p_${m.country}`, price(over[m.country] ?? "1000")])) } });
  const content = [{ key: "title", value: "Maya Dining Table" }, { key: "body_html", value: "<p>Solid oak</p>" }, { key: "meta_title", value: "Maya | Hardman" }, { key: "meta_description", value: "Solid oak table" }];
  const full = (code: string) => content.map((c) => ({ key: c.key, value: `${c.value} (${code})`, outdated: false }));
  const handlers = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
    ...baseHandlers(),
    ReadinessPricing: () => pricing(),
    ReadinessTranslations: () => ({ translatableResource: { translatableContent: content, tr_fr: full("fr"), tr_de: full("de").slice(0, 2), tr_nl: [] } }),
    ...extra,
  });

  it("one row per market with a dot", async () => {
    const { data } = await run(handlers(), ready.load);
    expect(data.rows.map((r) => r.state.def.key)).toEqual(["FR", "DE", "NL", "CH", "UK", "US"]);
    const by = Object.fromEntries(data.rows.map((r) => [r.state.def.key, r]));
    expect(by.FR!.dot).toBe("green");
    expect(by.DE!.translation).toBe("partial");
    expect(by.DE!.dot).toBe("amber");
    expect(by.DE!.translationNote).toBe("Needs translation: SEO title, SEO description.");
    expect(by.NL!.translation).toBe("missing");
    expect(by.UK!.translation).toBe("na");
    expect(by.UK!.dot).toBe("green");
    expect(by.CH!.translation).toBe("partial"); // Switzerland sells in German
    const out = html(<ReadyView data={data} />);
    expect(out).toContain("Ready");
    expect(out).toContain("Needs translation");
    expect(ready.dotOf(by.FR!)).toBe("green");
  });

  it("a zero price or no price makes the market red", async () => {
    const { data } = await run(handlers({ ReadinessPricing: () => pricing({ GB: "0" }) }), ready.load);
    expect(data.rows.find((r) => r.state.def.key === "UK")).toMatchObject({ price: "missing", dot: "red", priceNote: "The price is zero." });
  });

  it("checks the market adaptation only where one is set up", async () => {
    const s = defaultSettings();
    s.adaptations = [{ locale: "fr", marketId: "gid://shopify/Market/fr", marketName: "France" }];
    const { data, seen } = await run(handlers({ ReadinessTranslations: () => ({ translatableResource: { translatableContent: content, tr_fr: full("fr"), tr_de: [], tr_nl: [], ad_fr_fr: [] } }) }), ready.load, s);
    expect(seen.find((x) => x.name === "ReadinessTranslations")!.query).toContain('translations(locale: "fr", marketId: "gid://shopify/Market/fr")');
    const fr = data.rows.find((r) => r.state.def.key === "FR")!;
    expect(fr.adaptation).toBe("absent");
    expect(fr.dot).toBe("amber");
    expect(data.rows.find((r) => r.state.def.key === "DE")!.adaptation).toBe("na");
  });

  it("finds the delivery-time record for the wood", async () => {
    const delivery = (status: string) => ({ metaobjects: { nodes: [{ id: "gid://shopify/Metaobject/9", type: "build_and_delivery_time", handle: "oak", displayName: "Oak", capabilities: { publishable: { status } }, fields: [] }] } });
    const ok = await run(handlers({ FactsDelivery: () => delivery("ACTIVE") }), ready.load);
    expect(ok.data.rows.every((r) => r.delivery === "found")).toBe(true);
    expect(html(<ReadyView data={ok.data} />)).toContain("Delivery time");
    const draft = await run(handlers({ FactsDelivery: () => delivery("DRAFT") }), ready.load);
    expect(draft.data.rows.find((r) => r.state.def.key === "FR")).toMatchObject({ delivery: "draft", dot: "amber" });
    const denied = await run(handlers({ FactsDelivery: () => gqlError("Access denied", "ACCESS_DENIED") }), ready.load);
    expect(denied.data.rows[0]!.delivery).toBe("unknown");
    expect(denied.data.notes.join(" ")).toContain("metaobject permission");
  });

  it("still loads when translations are refused", async () => {
    const { data } = await run(handlers({ ReadinessTranslations: () => gqlError("Access denied for translatableResource field. Required access: `read_translations`", "ACCESS_DENIED") }), ready.load);
    expect(data.rows.find((r) => r.state.def.key === "FR")!.translation).toBe("unknown");
    expect(data.notes.join(" ")).toContain("Translations could not be read");
  });
});

describe("Options and swatches", () => {
  const swatchObj = (id: number, over: Record<string, unknown> = {}) => ({ id: `gid://shopify/Metaobject/${id}`, type: "swatches", handle: `swatch-${id}`, displayName: `Swatch ${id}`, capabilities: { publishable: { status: "ACTIVE" } }, fields: [{ key: "group", value: "Wood" }, { key: "group_key", value: "wood" }, { key: "group_priority", value: "1" }, { key: "model_3d", value: "gid://x" }], ...over });
  const product = (hide?: string) =>
    rawProduct({
      options: [{ name: "Wood", values: ["Oak", "Walnut", "Ash "] }],
      variants: {
        nodes: [
          rawVariant(1, { title: "Oak", selectedOptions: [{ name: "Wood", value: "Oak" }], m_custom_swatches_test: meta("gid://shopify/Metaobject/1", "metaobject_reference"), m_custom_hide_from_markets: meta(hide ?? null), weight: undefined, inventoryItem: { unitCost: { amount: "5" }, measurement: { weight: { value: 0, unit: "KILOGRAMS" } } } }),
          rawVariant(2, { title: "Walnut", selectedOptions: [{ name: "Wood", value: "Walnut" }], m_custom_swatches_test: meta("gid://shopify/Metaobject/2", "metaobject_reference"), m_custom_hide_from_markets: meta(hide ?? null), sku: "" }),
          rawVariant(3, { title: "Ash ", selectedOptions: [{ name: "Wood", value: "Ash " }], m_custom_hide_from_markets: meta(hide ?? null) }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
  const handlers = (hide?: string, recs?: Handler): Record<string, Handler> => ({
    FactsProduct: () => ({ product: product(hide) }),
    FactsRecords: recs ?? (() => ({ nodes: [swatchObj(1), swatchObj(2, { displayName: "Test 3", capabilities: { publishable: { status: "DRAFT" } }, fields: [{ key: "group", value: "Group 1" }, { key: "group_key", value: "" }] })] })),
  });

  it("lists each value with its swatch and flags the odd ones", async () => {
    const { data, seen } = await run(handlers(), options.load);
    const by = Object.fromEntries(data.values.map((v) => [v.value.trim(), v]));
    expect(by.Oak!.flags).toEqual([]);
    expect(by.Oak!.swatches[0]).toMatchObject({ group: "Wood", groupKey: "wood", priority: "1", hasModel: true });
    expect(by.Walnut!.flags).toEqual(expect.arrayContaining(["Draft swatch: Test 3", "Test-looking name: Test 3", "No group key"]));
    expect(by.Ash!.flags).toEqual(expect.arrayContaining(["Extra space", "No swatch"]));
    expect(seen.find((s) => s.name === "FactsRecords")!.vars.ids).toEqual(["gid://shopify/Metaobject/1", "gid://shopify/Metaobject/2"]);
    const out = html(<OptionsView data={data} />);
    expect(out).toContain("Draft swatch");
    expect(out).toContain("Variants to complete");
  });

  it("warns when every variant is hidden from a market", async () => {
    const { data } = await run(handlers("UK, fr"), options.load);
    expect(data.hiddenMarkets).toEqual(["FR", "UK"].sort((a, b) => ["FR", "DE", "NL", "CH", "UK", "US"].indexOf(a) - ["FR", "DE", "NL", "CH", "UK", "US"].indexOf(b)));
    expect(html(<OptionsView data={data} />)).toContain("Hidden in FR, UK");
    const json = await run(handlers('["US"]'), options.load);
    expect(json.data.hiddenMarkets).toEqual(["US"]);
    expect((await run(handlers(), options.load)).data.hiddenMarkets).toEqual([]);
  });

  it("lists variants without weight or SKU, ten first", async () => {
    const { data } = await run(handlers(), options.load);
    expect(data.variantIssues.map((v) => `${v.title}:${v.issues.join("+")}`)).toEqual(["Oak:Weight is 0", "Walnut:No SKU"]);
  });

  it("without the metaobject permission the swatches say so and the rest still shows", async () => {
    const { data } = await run(handlers(undefined, () => gqlError("Access denied for metaobjects field. Required access: `read_metaobjects` access scope.", "ACCESS_DENIED")), options.load);
    expect(data.recordsRead).toBe(false);
    expect(data.values.every((v) => v.swatches.length === 0 && !v.flags.includes("No swatch"))).toBe(true);
    expect(html(<OptionsView data={data} />)).toContain("need the metaobject permission");
  });
});

describe("Content snapshot", () => {
  it("shows numbers and marks the ones out of range", async () => {
    const { data, seen } = await run({ FactsProduct: () => ({ product: rawProduct({ seo: { title: "x".repeat(72), description: "short" }, media: { nodes: [{ id: "a", alt: "ok", mediaContentType: "IMAGE" }, { id: "b", alt: "", mediaContentType: "IMAGE" }], pageInfo: { hasNextPage: false } } }) }) }, snapshot.load);
    const by = Object.fromEntries(data.facts.map((f) => [f.key, f]));
    expect(by.seoTitle).toMatchObject({ value: "72 / 60", warn: true });
    expect(by.seoDesc).toMatchObject({ value: "5 / 160", warn: true, note: "Under 50" });
    expect(by.alt).toMatchObject({ value: "1 of 2 (50%)", warn: true });
    expect(by.body!.value).toBe("18 words");
    expect(by.wood!.value).toBe("Oak");
    expect(by.related!.value).toBe("1");
    expect(by.dimensions).toBeUndefined();
    const q = seen[0]!.query;
    expect(q).not.toContain("variants(");
    expect(q).not.toContain("resourcePublicationsV2");
    expect(html(<SnapshotView data={data} />)).toContain("72 / 60");
  });
  it("shows a dimensions row only when a theme field for it exists", async () => {
    const s = defaultSettings();
    s.themeFields.push({ id: "tf:custom.general_dimensions", label: "General dimensions", namespace: "custom", key: "general_dimensions", owner: "product", rule: "filled", profiles: ["real"], severity: "nice", on: true });
    const { data } = await run({ FactsProduct: () => ({ product: rawProduct({ m_custom_general_dimensions: meta("180 x 90") }) }) }, snapshot.load, s);
    expect(data.facts.find((f) => f.key === "dimensions")).toMatchObject({ label: "General dimensions", value: "Yes", warn: false });
  });
  it("draws a bar", () => {
    expect(bar(30, 60)).toBe("█████░░░░░");
    expect(bar(90, 60)).toBe("██████████");
    expect(bar(0, 60)).toBe("░░░░░░░░░░");
  });
});

describe("the shared reader", () => {
  it("asks for nothing it was not asked for", async () => {
    const fake = fakeShopify({ FactsProduct: () => ({ product: rawProduct() }) });
    const { q, soft } = makeQueries(fake.raw, async () => {});
    await loadFacts({ productId: PRODUCT, q, soft }, { publications: true });
    const query = fake.seen[0]!.query;
    expect(query).toContain("resourcePublicationsV2");
    for (const word of ["variants(", "media(", "seo {", "description", "options {"]) expect(query).not.toContain(word);
  });
  it("no new block sends a mutation", async () => {
    const all: string[] = [];
    for (const [handlers, load] of [
      [baseHandlers(), health.load],
      [baseHandlers(), quality.load],
      [baseHandlers(), options.load],
      [baseHandlers(), snapshot.load],
    ] as const) {
      const { seen } = await run({ ...handlers }, load as never).catch(() => ({ seen: [] as { query: string }[] }));
      all.push(...seen.map((s) => s.query));
    }
    expect(all.length).toBeGreaterThan(4);
    for (const q of all) expect(q).not.toMatch(/\bmutation\b/i);
  });
});
