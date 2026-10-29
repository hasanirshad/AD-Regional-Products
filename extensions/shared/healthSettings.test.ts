import { describe, expect, it } from "vitest";
import { parseTokens } from "./facts";
import { looksLikeTest } from "./records";
import { GROUPS, LEGACY_CHECK_RULES, PROFILES, RULE_CATALOGUE, defaultGroups, defaultThemeFields } from "./healthSettings";
import { defaultSettings, migrateSettings, parseSettings, problemsFor, problemsOf, serializeSettings, SETTINGS_VERSION, type BlockSettings } from "./settings";
import { analyse } from "../options-swatches/src/logic";
import { EMPTY_RECORDS } from "./records";
import { realProduct } from "../testkit/health";

const make = (f: (s: BlockSettings) => void) => {
  const s = defaultSettings();
  f(s);
  return s;
};

describe("version 2 defaults", () => {
  const d = defaultSettings();
  it("work with zero setup and have no problems", () => {
    expect(d.version).toBe(2);
    expect(SETTINGS_VERSION).toBe(2);
    expect(problemsOf(d)).toEqual([]);
  });
  it("groups: all on; option products skip SEO, images, theme fields and linked records", () => {
    expect(GROUPS.every((g) => d.groups.groups[g])).toBe(true);
    expect(PROFILES.every((p) => GROUPS.every((g) => typeof d.groups.profiles[p][g] === "boolean"))).toBe(true);
    expect(d.groups.profiles.option).toMatchObject({ seo: false, images: false, theme: false, linked: false, basics: true, variants: true, markets: true });
    expect(d.groups.profiles.real.linked).toBe(true);
  });
  it("thresholds are the ones in the brief", () => {
    expect(d.thresholds).toMatchObject({ seoTitleMax: 60, seoDescMin: 50, seoDescMax: 160, altTarget: 100, weights: { blocks: 3, hurts: 2, nice: 1 } });
  });
  it("theme fields are pre-filled from the store export", () => {
    const keys = d.themeFields.map((f) => `${f.namespace}.${f.key}:${f.rule}`);
    for (const k of ["custom.tag_line:filled", "custom.product_wood_type:clean", "custom.product_wood_type:sameAs", "custom.hd_related_products:handles", "custom.hd_recommended_products:handles", "custom.required_options:targets", "seo.hidden:boolean"]) expect(keys).toContain(k);
    expect(new Set(d.themeFields.map((f) => f.id)).size).toBe(d.themeFields.length);
  });
  it("helper rules know the wood names and the helper types", () => {
    expect(d.helpers.woodNames).toEqual(expect.arrayContaining(["oak", "ash", "american walnut", "all_materials"]));
    expect(d.helpers.types).toEqual(expect.arrayContaining(["finish", "edge", "legs", "service"]));
  });
  it("every single check belongs to a group, ids are unique", () => {
    expect(new Set(RULE_CATALOGUE.map((r) => r.id)).size).toBe(RULE_CATALOGUE.length);
    for (const r of RULE_CATALOGUE) expect(GROUPS).toContain(r.group);
  });
  it("the size stays far below the 100,000 character limit", () => {
    expect(serializeSettings(d).length).toBeLessThan(12_000);
  });
});

describe("migration from version 1", () => {
  const v1 = () => {
    const s = JSON.parse(serializeSettings(defaultSettings())) as Record<string, unknown>;
    for (const k of ["groups", "thresholds", "themeFields", "helpers", "records"]) delete s[k];
    s.version = 1;
    for (const m of s.markets as Record<string, unknown>[]) delete m.locale;
    return s;
  };
  it("fills the new sections from the defaults and keeps the old ones", () => {
    const old = v1();
    (old.sale as Record<string, string>).collectionHandle = "outlet";
    const r = parseSettings(JSON.stringify(old));
    expect(r.source).toBe("saved");
    expect(r.problems).toEqual([]);
    expect(r.settings.version).toBe(2);
    expect(r.settings.sale.collectionHandle).toBe("outlet");
    expect(r.settings.thresholds).toEqual(defaultSettings().thresholds);
    expect(r.settings.themeFields).toEqual(defaultSettings().themeFields);
    expect(r.settings.markets.map((m) => m.locale)).toEqual(["fr", "de", "nl", "de", "", ""]);
  });
  it("a single check switched off in version 1 stays off", () => {
    const old = v1();
    const checks = (old.quality as { checks: { id: string; on: boolean }[] }).checks;
    checks.find((c) => c.id === "seo")!.on = false;
    checks.find((c) => c.id === "price")!.on = false;
    const r = parseSettings(old);
    expect(r.settings.groups.disabledRules.sort()).toEqual([...LEGACY_CHECK_RULES.seo!, ...LEGACY_CHECK_RULES.price!].sort());
    expect(r.settings.groups.groups).toEqual(defaultGroups().groups);
  });
  it("leaves version 2 alone", () => {
    const s = { version: 2, anything: 1 };
    expect(migrateSettings(s)).toBe(s);
  });
  it("a newer version is refused", () => {
    expect(parseSettings({ version: 3 }).source).toBe("invalid");
  });
  it("a saved version 2 round-trips", () => {
    const s = make((x) => {
      x.thresholds.seoTitleMax = 70;
      x.helpers.expectedCategories = ["Chairs", "Tables"];
      x.groups.groups.linked = false;
      x.records.swatchType = "swatches_v2";
    });
    const r = parseSettings(serializeSettings(s));
    expect(r.source).toBe("saved");
    expect(r.settings).toEqual(s);
  });
  it("one bad new section falls back alone", () => {
    const s = JSON.parse(serializeSettings(defaultSettings())) as Record<string, unknown>;
    s.thresholds = { seoTitleMax: "sixty" };
    const r = parseSettings(s);
    expect(r.source).toBe("invalid");
    expect(r.settings.thresholds).toEqual(defaultSettings().thresholds);
    expect(r.settings.groups).toEqual(defaultSettings().groups);
    expect(r.problems[0]).toContain("Thresholds");
  });
});

describe("value rules for the new sections", () => {
  const bad = (f: (s: BlockSettings) => void, section: "thresholds" | "themeFields" | "helpers" | "records" | "groups" | "markets") => problemsFor(problemsOf(make(f)), section).map((p) => p.message);
  it("thresholds", () => {
    expect(bad((s) => void (s.thresholds.seoTitleMax = 5), "thresholds")[0]).toContain("SEO title maximum");
    expect(bad((s) => void ((s.thresholds.seoDescMin = 200), (s.thresholds.seoDescMax = 100)), "thresholds").join()).toContain("minimum cannot be above");
    expect(bad((s) => void (s.thresholds.altTarget = 120), "thresholds")[0]).toContain("0 to 100");
    expect(bad((s) => void (s.thresholds.weights = { blocks: 0, hurts: 0, nice: 0 }), "thresholds")[0]).toContain("above zero");
    expect(bad((s) => void (s.thresholds.primaryMarket = "XX"), "thresholds")[0]).toContain("Markets tab");
    expect(bad((s) => void (s.thresholds.primaryMarket = ""), "thresholds")).toEqual([]);
  });
  it("theme fields", () => {
    expect(bad((s) => void (s.themeFields[0]!.key = "x"), "themeFields")[0]).toContain("metafield key");
    expect(bad((s) => void s.themeFields.push({ ...s.themeFields[0]! }), "themeFields")[0]).toContain("listed twice");
    expect(bad((s) => void (s.themeFields[3]!.other = undefined), "themeFields")[0]).toContain("compare with");
    expect(bad((s) => void (s.themeFields[4]!.owner = "variant"), "themeFields")[0]).toContain("product metafields only");
  });
  it("helpers and records", () => {
    expect(bad((s) => void s.helpers.types.push(" "), "helpers")[0]).toContain("1 to 60");
    expect(bad((s) => void s.helpers.tags.push("option"), "helpers")[0]).toContain("listed twice");
    expect(bad((s) => void (s.records.swatchType = "bad type!"), "records")[0]).toContain("metaobject type");
    expect(bad((s) => void (s.records.swatchType = ""), "records")).toEqual([]);
  });
  it("a market language", () => {
    expect(bad((s) => void (s.markets[0]!.locale = "fr!"), "markets")[0]).toContain("language code");
    expect(bad((s) => void (s.markets[0]!.locale = "de-CH"), "markets")).toEqual([]);
  });
});

describe("small helpers", () => {
  it("parseTokens reads JSON lists and plain lists", () => {
    expect(parseTokens('["a","b"]')).toEqual(["a", "b"]);
    expect(parseTokens("a, b\nc;d")).toEqual(["a", "b", "c", "d"]);
    expect(parseTokens('"quoted"')).toEqual(["quoted"]);
    expect(parseTokens(null)).toEqual([]);
    expect(parseTokens("[broken")).toEqual(["[broken"]);
  });
  it("looksLikeTest", () => {
    for (const t of ["Test 3", "Group 1", "1", "swatches test"]) expect(looksLikeTest(t), t).toBe(true);
    for (const t of ["Wood", "Oak", "Group A", "", null]) expect(looksLikeTest(t), String(t)).toBe(false);
  });
  it("themeFields default ids are stable", () => {
    expect(defaultThemeFields().map((f) => f.id)).toContain("tf:custom.product_wood_type~material-main-title");
  });
});

describe("options: duplicate values", () => {
  it("a value listed twice after trimming is flagged", () => {
    const f = realProduct({ options: [{ name: "Wood", values: ["Oak", "oak "] }], variants: [] });
    const d = analyse(f, { ...EMPTY_RECORDS, state: "ok" }, defaultSettings());
    expect(d.values.map((v) => v.flags)).toEqual([[], ["Listed twice", "Extra space"]]);
  });
});
