import { describe, expect, it } from "vitest";
import { GROUPS, defaultSettings, type BlockSettings } from "../../../extensions/shared/settings";
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
  it("data quality runs the real engine on a sample product", () => {
    const p = previewOf("quality", defaultSettings());
    expect(p.summary).toMatch(/^\d+\/100 · /);
    const pending = p.tables.find((t) => t.title === "Pending")!;
    expect(pending.rows.map((r) => r[0]!.text)).toEqual(expect.arrayContaining(["Images have alt text", "SEO title is not too long", "SKU is filled"]));
    expect(p.tables.map((t) => t.title)).toEqual(expect.arrayContaining(["Basics", "SEO", "Images", "Variants and pricing"]));
  });
  it("a group switched off, or a single check, disappears from the preview", () => {
    const off = previewOf("groups", make((x) => (x.groups.groups.seo = false)));
    expect(off.tables.some((t) => t.title === "SEO")).toBe(false);
    const single = previewOf("groups", make((x) => (x.groups.disabledRules = ["variants.sku"])));
    expect(single.tables.find((t) => t.title === "Pending")!.rows.some((r) => r[0]!.text === "SKU is filled")).toBe(false);
  });
  it("thresholds change the verdict of the sample", () => {
    const p = previewOf("thresholds", make((x) => (x.thresholds.seoTitleMax = 200)));
    expect(p.tables.find((t) => t.title === "Pending")!.rows.some((r) => r[0]!.text === "SEO title is not too long")).toBe(false);
    const strict = previewOf("thresholds", make((x) => (x.thresholds.minImages = 5)));
    expect(strict.tables.find((t) => t.title === "Pending")!.rows.some((r) => r[0]!.text === "Enough images")).toBe(true);
  });
  it("a theme field that is switched off, or one that is filled, is counted", () => {
    const base = previewOf("themeFields", defaultSettings());
    const rows = (p: ReturnType<typeof previewOf>) => p.tables.find((t) => t.title === "Theme fields")!.rows.map((r) => r[0]!.text);
    expect(rows(base)).toContain("Tag line");
    const off = previewOf("themeFields", make((x) => x.themeFields.forEach((f) => (f.on = false))));
    expect(rows(off)).not.toContain("Tag line");
  });
  it("says so when every group is off", () => {
    const p = previewOf("groups", make((x) => GROUPS.forEach((g) => (x.groups.groups[g] = false))));
    expect(p.empty).toContain("No check applies");
  });
  it("helper rules show which kind of product a few made-up products are judged as", () => {
    const p = previewOf("helpers", defaultSettings());
    const judged = p.tables[0]!.rows.map((r) => [r[0]!.text, r[2]!.text]);
    expect(judged).toEqual(expect.arrayContaining([["Oak Dining Table", "Real product"], ["Light Oak Finish", "Option product"], ["Dining Set", "Bundle"]]));
    const custom = previewOf("helpers", make((x) => (x.helpers.types = ["tables"])));
    expect(custom.tables[0]!.rows.find((r) => r[0]!.text === "Light Oak Finish")![2]!.text).toBe("Option product");
  });
  it("linked records list the types in use and say which are skipped", () => {
    const p = previewOf("records", make((x) => (x.records.designType = "")));
    expect(p.tables[0]!.rows.find((r) => r[0]!.text === "Design and customisation")![1]!.text).toBe("Not used");
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
