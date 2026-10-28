import { describe, expect, it } from "vitest";
import { defaultSettings, type BlockSettings } from "../../../extensions/shared/settings";
import { previewOf } from "./blockPreview";
import { slotsWithAdaptations, type ShopLocale } from "./locales";

const make = (change: (s: BlockSettings) => void) => {
  const s = structuredClone(defaultSettings());
  change(s);
  return s;
};

describe("previews use the real block code on sample data", () => {
  it("translation status follows the chosen rows, order and languages", () => {
    const s = make((x) => {
      x.languages = [{ code: "es", label: "Spanish" }, { code: "fr", label: "French" }];
      x.translation.rows = [{ type: "core", field: "handle" }, { type: "core", field: "title" }, { type: "optionNames" }];
    });
    const p = previewOf("translation", s);
    expect(p.tables[0]!.headers).toEqual(["Field", "ES", "FR"]);
    expect(p.tables[0]!.rows.map((r) => r[0]!.text)).toEqual(["Handle (URL)", "Title", "Option name: Size"]);
    const states = new Set(p.tables[0]!.rows.flatMap((r) => r.slice(1).map((c) => c.text)));
    expect(states.size).toBeGreaterThan(1);
  });
  it("uses the store's real metafields for a namespace row when they are known", () => {
    const s = make((x) => (x.translation.rows = [{ type: "namespace", namespace: "custom" }]));
    const p = previewOf("translation", s, { known: [{ namespace: "custom", key: "care" }, { namespace: "other", key: "x" }] });
    expect(p.tables[0]!.rows.map((r) => r[0]!.text)).toEqual(["custom.care"]);
  });
  it("data quality: switched-off checks vanish and lead time shows once its metafield is set", () => {
    const base = previewOf("quality", defaultSettings());
    expect(base.tables[0]!.rows.find((r) => r[0]!.text === "Lead time set")![1]!.text).toBe("Not configured");
    const s = make((x) => {
      x.quality.checks = x.quality.checks.filter((c) => c.id !== "seo");
      x.quality.fields.leadTime = [{ label: "Lead time", namespace: "custom", key: "lead_time", owner: "product" }];
    });
    const p = previewOf("quality", s);
    expect(p.tables[0]!.rows.some((r) => r[0]!.text.startsWith("SEO"))).toBe(false);
    expect(p.tables[0]!.rows.find((r) => r[0]!.text === "Lead time set")![1]!.text).toBe("Fail");
  });
  it("says so when every check is off", () => {
    const p = previewOf("quality", make((x) => x.quality.checks.forEach((c) => (c.on = false))));
    expect(p.empty).toContain("No checks");
  });
  it("quick links use the saved domains and theme", () => {
    const s = make((x) => {
      x.links.previewThemeId = "123456789";
      x.markets[0]!.domain = "shop.example.fr";
    });
    const p = previewOf("links", s);
    expect(p.links[0]!.url).toBe("https://shop.example.fr/products/oak-table");
    expect(p.links.at(-1)!.url).toContain("preview_theme_id=123456789");
    expect(previewOf("links", defaultSettings()).notes[0]).toContain("No preview theme");
  });
  it("markets, sale, collections and activity reflect their settings", () => {
    expect(previewOf("markets", make((x) => x.markets.forEach((m) => (m.enabled = m.key === "FR")))).tables[0]!.rows).toHaveLength(1);
    expect(previewOf("sale", make((x) => (x.sale = { badgeNamespace: "marketing", badgeKey: "ribbon", collectionHandle: "" }))).tables[1]!.title).toBe("Badge (marketing.ribbon)");
    expect(previewOf("sale", make((x) => (x.sale.collectionHandle = ""))).notes[0]).toContain("No sale collection");
    const c = previewOf("collections", make((x) => (x.collections = { showTags: false, showType: false })));
    expect(c.tables[0]!.headers).toEqual(["Collection"]);
    expect(c.pills).toEqual([]);
    expect(previewOf("activity", make((x) => (x.activity.eventsLimit = 3))).tables[0]!.rows).toHaveLength(3);
    expect(previewOf("activity", make((x) => (x.activity.eventsLimit = Number.NaN))).tables[0]!.rows).toHaveLength(0);
  });
  it("adaptations explain themselves when there are none", () => {
    expect(previewOf("adaptations", defaultSettings()).empty).toContain("No adaptation");
  });
});

describe("adaptation slots", () => {
  const locales: ShopLocale[] = [
    { locale: "en", name: "English", primary: true, published: true },
    { locale: "fr", name: "French", primary: false, published: true },
  ];
  const us = { locale: "en", marketId: "gid://shopify/Market/1", marketName: "United States" };
  it("adds one box per adaptation after the language boxes", () => {
    const slots = slotsWithAdaptations(locales, [us], new Set([us.marketId]));
    expect(slots.map((s) => s.key)).toEqual(["fr", "en@gid://shopify/Market/1"]);
    expect(slots[1]).toMatchObject({ label: "English · United States", locale: "en", marketId: us.marketId });
  });
  it("leaves out a deleted market, a language the store dropped, and duplicates", () => {
    expect(slotsWithAdaptations(locales, [us], new Set(["gid://shopify/Market/9"]))).toHaveLength(1);
    expect(slotsWithAdaptations(locales, [{ ...us, locale: "de" }], new Set([us.marketId]))).toHaveLength(1);
    expect(slotsWithAdaptations(locales, [us, us], new Set([us.marketId]))).toHaveLength(2);
  });
  it("shows none until the markets are known", () => {
    expect(slotsWithAdaptations(locales, [us], null).map((s) => s.key)).toEqual(["fr"]);
  });
});
