// The blocks with saved settings: each setting changes what the block asks for or shows.
import { describe, expect, it } from "vitest";
import { render as html } from "preact-render-to-string";
import { fakeShopify, type Handler } from "./testkit/fake";
import { makeQueries, type LoadContext } from "./shared/graphql";
import { defaultSettings, type BlockSettings } from "./shared/settings";
import * as market from "./market-availability/src/logic";
import * as translation from "./translation-status/src/logic";
import * as sale from "./sale-badge/src/logic";
import { View as SaleView } from "./sale-badge/src/Block";
import * as collections from "./collections-tags/src/logic";
import { View as CollectionsView } from "./collections-tags/src/Block";
import * as links from "./quick-links/src/logic";
import * as activity from "./recent-activity/src/logic";

const PRODUCT = "gid://shopify/Product/111";
const make = (change: (s: BlockSettings) => void) => {
  const s = structuredClone(defaultSettings());
  change(s);
  return s;
};

async function run<T>(settings: BlockSettings, handlers: Record<string, Handler>, load: (c: LoadContext) => Promise<T>) {
  const fake = fakeShopify(handlers);
  const { q, soft } = makeQueries(fake.raw, async () => {});
  const data = await load({ productId: PRODUCT, q, soft, settings });
  return { data, seen: fake.seen };
}

describe("Translation status with settings", () => {
  const base = {
    product: {
      id: PRODUCT,
      options: [{ id: "opt1", name: "Size", optionValues: [{ id: "val1", name: "Small" }] }],
      ns0: { nodes: [{ id: "mf1", namespace: "custom", key: "care" }] },
      mf0: { id: "mf9", namespace: "specs", key: "weight" },
    },
    translatableResource: { translatableContent: [{ key: "title", value: "Oak table" }, { key: "handle", value: "oak-table" }, { key: "meta_title", value: "Oak" }], tr_fr: [{ key: "title", value: "Table" }], tr_es: [] },
  };
  const nested = {
    translatableResourcesByIds: {
      nodes: [
        { resourceId: "opt1", translatableContent: [{ key: "name", value: "Size" }], tr_fr: [], tr_es: [] },
        { resourceId: "val1", translatableContent: [{ key: "name", value: "Small" }], tr_fr: [], tr_es: [] },
        { resourceId: "mf1", translatableContent: [{ key: "value", value: "Wipe" }], tr_fr: [], tr_es: [] },
        { resourceId: "mf9", translatableContent: [{ key: "value", value: "5 kg" }], tr_fr: [{ key: "value", value: "5 kg x" }], tr_es: [] },
      ],
    },
  };
  const handlers = { TranslationBase: () => base, TranslationNested: () => nested };

  it("shows the chosen rows in the chosen order, and the chosen languages", async () => {
    const s = make((x) => {
      x.languages = [{ code: "es", label: "Spanish" }, { code: "fr", label: "French" }];
      x.translation.rows = [{ type: "metafield", namespace: "specs", key: "weight" }, { type: "core", field: "handle" }, { type: "core", field: "title" }];
    });
    const { data, seen } = await run(s, handlers, translation.load);
    expect(data.rows.map((r) => r.label)).toEqual(["specs.weight", "Handle (URL)", "Title"]);
    expect(data.languages.map((l) => l.code)).toEqual(["es", "fr"]);
    expect(Object.keys(data.rows[0]!.cells)).toEqual(["es", "fr"]);
    expect(seen[0]!.query).toContain('mf0: metafield(namespace: "specs", key: "weight")');
    expect(seen[0]!.query).toContain('tr_es: translations(locale: "es")');
    expect(seen[0]!.query).not.toContain("ns0");
    // Only the one metafield is looked up: no options, no namespace.
    expect(seen[1]!.vars.ids).toEqual(["mf9"]);
  });

  it("leaves out option rows when they are not chosen and asks for nothing nested when nothing needs it", async () => {
    const s = make((x) => (x.translation.rows = [{ type: "core", field: "title" }, { type: "core", field: "meta_title" }]));
    const { data, seen } = await run(s, handlers, translation.load);
    expect(data.rows.map((r) => r.key)).toEqual(["title", "meta_title"]);
    expect(seen.map((x) => x.name)).toEqual(["TranslationBase"]);
  });

  it("option names and option values are separate rows that can be ordered", async () => {
    const s = make((x) => (x.translation.rows = [{ type: "optionValues" }, { type: "optionNames" }]));
    const { data } = await run(s, handlers, translation.load);
    expect(data.rows.map((r) => r.key)).toEqual(["optv:opt1", "opt:opt1"]);
  });
});

describe("Quick links with settings", () => {
  it("uses the saved theme id and domains", async () => {
    const s = make((x) => {
      x.links.previewThemeId = "999888777";
      x.links.previewMarket = "DE";
      x.markets.find((m) => m.key === "DE")!.domain = "shop.example.de";
      x.markets.find((m) => m.key === "FR")!.enabled = false;
    });
    const { data } = await run(s, { QuickLinks: () => ({ shop: { myshopifyDomain: "hardman.myshopify.com" }, product: { handle: "oak", status: "ACTIVE" } }) }, links.load);
    expect(data.storefront.map((l) => l.key)).toEqual(["DE", "NL", "CH", "UK", "US"]);
    expect(data.storefront[0]!.url).toBe("https://shop.example.de/products/oak");
    expect(data.preview!.url).toBe("https://shop.example.de/products/oak?preview_theme_id=999888777");
  });
});

describe("Market availability with settings", () => {
  it("lists only the turned-on markets and asks for their prices", async () => {
    const s = make((x) => x.markets.forEach((m) => (m.enabled = m.key === "FR" || m.key === "US")));
    const { data, seen } = await run(s, { MarketAvailability: () => ({ product: { id: PRODUCT, status: "ACTIVE" }, markets: { nodes: [] } }) }, market.load);
    expect(data.rows.map((r) => r.def.key)).toEqual(["FR", "US"]);
    expect(seen[0]!.query).toContain("p_FR");
    expect(seen[0]!.query).toContain("p_US");
    expect(seen[0]!.query).not.toContain("p_DE");
  });
  it("finds a market by the handle given in the settings", async () => {
    const s = make((x) => {
      x.markets = [{ key: "EU", label: "Europe", country: "DE", domain: "hardmandesign.de", stayUs: false, marketHandle: "eu", enabled: true, locale: "" }];
      x.links.previewMarket = "EU";
    });
    const nodes = [{ id: "a", name: "Germany", handle: "germany", status: "ACTIVE", catalogs: { nodes: [{ id: "c1" }] }, conditions: { regionsCondition: { regions: { nodes: [{ __typename: "MarketRegionCountry", code: "DE" }] } } } }, { id: "b", name: "Europe", handle: "eu", status: "ACTIVE", catalogs: { nodes: [{ id: "c2" }] } }];
    const { data } = await run(s, { MarketAvailability: () => ({ product: { id: PRODUCT, status: "ACTIVE", resourcePublicationsV2: { nodes: [{ publication: { catalog: { id: "c2" } } }] } }, markets: { nodes } }) }, market.load);
    expect(data.rows[0]).toMatchObject({ marketName: "Europe", state: "published" });
  });
});

describe("Sale and badge with settings", () => {
  const saleProduct = (badge: unknown, handles: string[]) => ({ product: { id: PRODUCT, badge, collections: { nodes: handles.map((h) => ({ id: `gid://shopify/Collection/${h}`, title: h, handle: h, ruleSet: null })), pageInfo: { hasNextPage: false } } } });
  it("uses the saved badge metafield, collection handle and languages", async () => {
    const s = make((x) => {
      x.sale = { badgeNamespace: "marketing", badgeKey: "ribbon", collectionHandle: "clearance" };
      x.languages = [{ code: "es", label: "Spanish" }];
    });
    const { data, seen } = await run(
      s,
      {
        SaleBadge: () => saleProduct({ id: "mfb", value: "Deal" }, ["clearance"]),
        BadgeTranslations: () => ({ translatableResource: { translatableContent: [{ key: "value", value: "Deal" }], tr_es: [] } }),
      },
      sale.load,
    );
    expect(seen[0]!.query).toContain('metafield(namespace: "marketing", key: "ribbon")');
    expect(seen[1]!.query).toContain('tr_es: translations(locale: "es")');
    expect(data.inSaleCollection).toBe(true);
    expect(data.badge.translations).toMatchObject({ es: { status: "missing" } });
    const out = html(<SaleView data={data} />);
    expect(out).toContain("Badge (marketing.ribbon)");
    expect(out).toContain("In &quot;clearance&quot;");
  });
  it("an empty collection handle hides the sale collection check", async () => {
    const s = make((x) => (x.sale.collectionHandle = ""));
    const { data } = await run(s, { SaleBadge: () => saleProduct(null, ["sale"]) }, sale.load);
    expect(data.inSaleCollection).toBe(false);
    expect(html(<SaleView data={data} />)).not.toContain("Sale collection");
  });
});

describe("Collections and tags with settings", () => {
  const raw = { shop: { myshopifyDomain: "h.myshopify.com" }, product: { tags: ["a"], collections: { nodes: [{ id: "gid://shopify/Collection/1", title: "Tables", handle: "t", ruleSet: null }], pageInfo: { hasNextPage: false } } } };
  it("hides tags and the type column when asked", async () => {
    const s = make((x) => (x.collections = { showTags: false, showType: false }));
    const { data } = await run(s, { CollectionsTags: () => raw }, collections.load);
    const out = html(<CollectionsView data={data} />);
    expect(out).toContain("Tables");
    expect(out).not.toContain("Tags (");
    expect(out).not.toContain("Manual");
  });
});

describe("Recent activity with settings", () => {
  it("asks for the saved number of events", async () => {
    const s = make((x) => (x.activity.eventsLimit = 7));
    const { seen } = await run(s, { RecentActivity: () => ({ product: { updatedAt: "2026-10-27T00:00:00Z", events: { nodes: [] } } }) }, activity.load);
    expect(seen[0]!.vars.first).toBe(7);
  });
});

describe("no settings given", () => {
  it("every block works with the defaults", async () => {
    const fake = fakeShopify({ RecentActivity: () => ({ product: { updatedAt: "2026-10-27T00:00:00Z", events: { nodes: [] } } }) });
    const { q, soft } = makeQueries(fake.raw, async () => {});
    await activity.load({ productId: PRODUCT, q, soft });
    expect(fake.seen[0]!.vars.first).toBe(20);
  });
});
