import { describe, expect, it } from "vitest";
import { LANGUAGES, MARKETS, REQUIRED_FIELDS } from "./constants";
import {
  CHECK_CATALOGUE,
  customCheckId,
  defaultSettings,
  domainProblem,
  normalizeDomain,
  normalizeThemeId,
  parseSettings,
  problemsAgainstDefinitions,
  problemsFor,
  problemsOf,
  readSettings,
  serializeSettings,
  SETTINGS_KEY,
  SETTINGS_NAMESPACE,
  SETTINGS_QUERY,
  themeIdProblem,
  type BlockSettings,
} from "./settings";

const clone = (s: BlockSettings) => structuredClone(s);

describe("defaults are today's behaviour", () => {
  const d = defaultSettings();
  it("come from the constants file", () => {
    expect(d.languages.map((l) => l.code)).toEqual(LANGUAGES.map((l) => l.code));
    expect(d.markets.map((m) => m.key)).toEqual(MARKETS.map((m) => m.key));
    expect(d.quality.fields.length).toEqual(REQUIRED_FIELDS.length);
    expect(d.quality.fields.leadTime).toEqual([]);
    expect(d.sale).toEqual({ badgeNamespace: "custom", badgeKey: "sale_badge", collectionHandle: "sale" });
    expect(d.activity.eventsLimit).toBe(20);
    expect(d.adaptations).toEqual([]);
  });
  it("list the eight built-in checks, all on", () => {
    expect(d.quality.checks.map((c) => c.id)).toEqual(["image", "alt", "spaces", "lengthSeater", "seo", "lead", "price", "market"]);
    expect(d.quality.checks.every((c) => c.on)).toBe(true);
  });
  it("have no problems", () => {
    expect(problemsOf(d)).toEqual([]);
  });
  it("are a fresh copy each time", () => {
    const a = defaultSettings();
    a.languages.pop();
    expect(defaultSettings().languages).toHaveLength(LANGUAGES.length);
  });
  it("the catalogue covers every kind once, and only metafield can repeat", () => {
    expect(CHECK_CATALOGUE.map((c) => c.kind)).toEqual(["image", "alt", "spaces", "lengthSeater", "seo", "lead", "price", "market", "metafield"]);
    expect(CHECK_CATALOGUE.filter((c) => c.repeatable).map((c) => c.kind)).toEqual(["metafield"]);
  });
});

describe("parseSettings: missing or invalid data falls back to the defaults", () => {
  it("nothing saved", () => {
    for (const raw of [null, undefined, ""]) {
      const r = parseSettings(raw);
      expect(r.source).toBe("default");
      expect(r.settings).toEqual(defaultSettings());
    }
  });
  it("text that is not JSON", () => {
    const r = parseSettings("{not json");
    expect(r.source).toBe("invalid");
    expect(r.settings).toEqual(defaultSettings());
    expect(r.problems[0]).toContain("not valid JSON");
  });
  it("JSON that is not an object", () => {
    for (const raw of ["[]", "42", '"x"', "null"]) {
      const r = parseSettings(raw);
      expect(r.settings).toEqual(defaultSettings());
    }
  });
  it("a version from the future", () => {
    const r = parseSettings(JSON.stringify({ version: 99 }));
    expect(r.source).toBe("invalid");
    expect(r.settings).toEqual(defaultSettings());
  });
  it("too much text", () => {
    expect(parseSettings("x".repeat(200_000)).source).toBe("invalid");
  });
  it("keeps what is valid and replaces only the section that is wrong", () => {
    const s = clone(defaultSettings());
    s.activity.eventsLimit = 8;
    s.sale.collectionHandle = "clearance";
    const raw = JSON.parse(serializeSettings(s));
    raw.links = { previewThemeId: "not a theme", previewMarket: "UK" };
    raw.languages = "French";
    const r = parseSettings(JSON.stringify(raw));
    expect(r.source).toBe("invalid");
    expect(r.settings.activity.eventsLimit).toBe(8);
    expect(r.settings.sale.collectionHandle).toBe("clearance");
    expect(r.settings.links).toEqual(defaultSettings().links);
    expect(r.settings.languages).toEqual(defaultSettings().languages);
    expect(r.problems).toHaveLength(2);
  });
  it("an older save without a section takes the default for it, without a complaint", () => {
    const r = parseSettings(JSON.stringify({ version: 1, activity: { eventsLimit: 5 } }));
    expect(r.source).toBe("saved");
    expect(r.problems).toEqual([]);
    expect(r.settings.activity.eventsLimit).toBe(5);
    expect(r.settings.markets).toEqual(defaultSettings().markets);
  });
  it("round-trips a full save", () => {
    const s = clone(defaultSettings());
    s.languages.push({ code: "es", label: "Spanish" });
    s.quality.fields.leadTime = [{ label: "Lead time", namespace: "custom", key: "lead_time", owner: "product" }];
    s.quality.checks.push({ id: customCheckId({ owner: "product", namespace: "custom", key: "care" }), kind: "metafield", label: "Care text filled", on: true, field: { label: "Care", namespace: "custom", key: "care", owner: "product" } });
    s.translation.rows = [{ type: "core", field: "title" }, { type: "metafield", namespace: "custom", key: "care" }, { type: "optionValues" }];
    s.adaptations = [{ locale: "en", marketId: "gid://shopify/Market/1", marketName: "United States" }];
    const r = parseSettings(serializeSettings(s));
    expect(r.source).toBe("saved");
    expect(r.settings).toEqual(s);
  });
  it("accepts an already parsed object", () => {
    expect(parseSettings(defaultSettings()).source).toBe("saved");
  });
  it("a preview market that no longer exists moves to the first market", () => {
    const s = clone(defaultSettings());
    s.markets = s.markets.filter((m) => m.key !== "UK");
    const r = parseSettings(JSON.stringify({ ...s, links: { previewThemeId: "", previewMarket: "UK" } }));
    expect(r.settings.links.previewMarket).toBe("FR");
  });
});

describe("value rules", () => {
  const bad = (change: (s: BlockSettings) => void) => {
    const s = clone(defaultSettings());
    change(s);
    return problemsOf(s);
  };
  it("theme id", () => {
    expect(themeIdProblem("")).toBeNull();
    expect(themeIdProblem("143918219507")).toBeNull();
    expect(themeIdProblem("12ab")).toMatch(/digits only/);
    expect(bad((s) => (s.links.previewThemeId = "abc"))[0]?.path).toBe("links.previewThemeId");
  });
  it("normalizes a pasted theme address or GID", () => {
    expect(normalizeThemeId("https://admin.shopify.com/store/hardman/themes/143918219507/editor")).toBe("143918219507");
    expect(normalizeThemeId("gid://shopify/OnlineStoreTheme/143918219507")).toBe("143918219507");
    expect(normalizeThemeId("  143918219507 ")).toBe("143918219507");
  });
  it("domain", () => {
    expect(domainProblem("hardmandesign.fr")).toBeNull();
    expect(domainProblem("example.com/fr")).toBeNull();
    expect(domainProblem("https://x.com")).toMatch(/no https/);
    expect(domainProblem("x.com/")).not.toBeNull();
    expect(domainProblem("")).not.toBeNull();
    expect(normalizeDomain(" HTTPS://Hardmandesign.FR/ ")).toBe("hardmandesign.fr");
  });
  it("metafield keys", () => {
    expect(bad((s) => (s.sale.badgeKey = "bad key"))[0]?.path).toBe("sale.badgeKey");
    expect(bad((s) => (s.sale.badgeNamespace = "a"))[0]?.path).toBe("sale.badgeKey");
    expect(bad((s) => s.quality.fields.leadTime.push({ label: "Lead", namespace: "custom", key: "x y", owner: "product" }))[0]?.path).toBe("quality.fields.leadTime.0.key");
    expect(bad((s) => s.quality.fields.leadTime.push({ label: "", namespace: "custom", key: "lead_time", owner: "product" }))[0]?.path).toBe("quality.fields.leadTime.0.label");
  });
  it("languages, markets, collection handle, events", () => {
    expect(bad((s) => (s.languages = []))[0]?.path).toBe("languages");
    expect(bad((s) => s.languages.push({ code: "fr", label: "Again" }))[0]?.message).toContain("twice");
    expect(bad((s) => (s.languages[0]!.code = "not a code"))[0]?.path).toBe("languages.0.code");
    expect(bad((s) => (s.markets[0]!.country = "fr"))[0]?.path).toBe("markets.0.country");
    expect(bad((s) => (s.markets[1]!.key = "FR"))[0]?.message).toContain("twice");
    expect(bad((s) => (s.markets[0]!.marketHandle = "Not A Handle"))[0]?.path).toBe("markets.0.marketHandle");
    expect(bad((s) => (s.sale.collectionHandle = "Sale!"))[0]?.path).toBe("sale.collectionHandle");
    expect(bad((s) => (s.sale.collectionHandle = ""))).toEqual([]);
    for (const n of [0, 51, 2.5, Number.NaN]) expect(bad((s) => (s.activity.eventsLimit = n))[0]?.path).toBe("activity.eventsLimit");
  });
  it("rows and checks", () => {
    expect(bad((s) => (s.translation.rows = []))[0]?.path).toBe("translation.rows");
    expect(bad((s) => s.translation.rows.push({ type: "core", field: "title" }))[0]?.message).toContain("twice");
    expect(bad((s) => s.quality.checks.push({ id: "mf:x", kind: "metafield", label: "Custom", on: true }))[0]?.path).toBe("quality.checks.8.field");
    expect(bad((s) => s.quality.checks.push({ id: "image", kind: "image", label: "Image", on: true }))[0]?.message).toContain("twice");
  });
  it("adaptations", () => {
    expect(bad((s) => s.adaptations.push({ locale: "en", marketId: "x", marketName: "US" }))[0]?.path).toBe("adaptations.0.marketId");
    const ok = { locale: "en", marketId: "gid://shopify/Market/1", marketName: "US" };
    expect(bad((s) => s.adaptations.push(ok, ok))[0]?.message).toContain("twice");
  });
  it("problemsFor picks one section", () => {
    const s = clone(defaultSettings());
    s.sale.badgeKey = "x";
    s.activity.eventsLimit = 0;
    const all = problemsOf(s);
    expect(problemsFor(all, "sale")).toHaveLength(1);
    expect(problemsFor(all, "activity")).toHaveLength(1);
    expect(problemsFor(all, "links")).toHaveLength(0);
  });
});

describe("metafield keys must be real definitions", () => {
  const defs = { product: [{ namespace: "custom", key: "sale_badge" }, { namespace: "custom", key: "care" }], variant: [{ namespace: "custom", key: "variant_length" }, { namespace: "custom", key: "variant_table_person_space" }] };
  it("passes when every key exists", () => {
    expect(problemsAgainstDefinitions(defaultSettings(), defs)).toEqual([]);
  });
  it("names the key that does not exist", () => {
    const s = clone(defaultSettings());
    s.sale.badgeKey = "badge_text";
    s.quality.fields.leadTime = [{ label: "Lead time", namespace: "custom", key: "lead_time", owner: "product" }];
    s.translation.rows.push({ type: "metafield", namespace: "custom", key: "missing_one" });
    const p = problemsAgainstDefinitions(s, defs);
    expect(p.map((x) => x.path).sort()).toEqual(["quality.fields.leadTime.0", "sale.badgeKey", `translation.rows.${s.translation.rows.length - 1}`].sort());
    expect(p[0]!.message).toContain("metafield definition");
  });
  it("a variant metafield is not accepted as a product one", () => {
    const s = clone(defaultSettings());
    s.quality.fields.leadTime = [{ label: "Length", namespace: "custom", key: "variant_length", owner: "product" }];
    expect(problemsAgainstDefinitions(s, defs)).toHaveLength(1);
  });
  it("a list that could not be read is not checked", () => {
    const s = clone(defaultSettings());
    s.sale.badgeKey = "anything";
    expect(problemsAgainstDefinitions(s, { product: null, variant: null })).toEqual([]);
  });
  it("a namespace row needs definitions in that namespace", () => {
    const s = clone(defaultSettings());
    s.translation.rows = [{ type: "namespace", namespace: "nothing_here" }];
    expect(problemsAgainstDefinitions(s, defs)).toHaveLength(1);
  });
});

describe("readSettings (what a block does when it loads)", () => {
  const answer = (value: string | null | undefined) => async (query: string) => {
    expect(query).toBe(SETTINGS_QUERY);
    return { data: { currentAppInstallation: { metafield: value === undefined ? null : { value } } }, error: null };
  };
  it("asks for the right metafield and only reads", () => {
    expect(SETTINGS_QUERY).toContain(`namespace: "${SETTINGS_NAMESPACE}"`);
    expect(SETTINGS_QUERY).toContain(`key: "${SETTINGS_KEY}"`);
    expect(SETTINGS_QUERY).not.toMatch(/mutation/i);
  });
  it("uses the saved settings", async () => {
    const s = clone(defaultSettings());
    s.activity.eventsLimit = 3;
    const r = await readSettings(answer(serializeSettings(s)));
    expect(r.settings.activity.eventsLimit).toBe(3);
    expect(r.notice).toBeNull();
  });
  it("uses the defaults, quietly, when nothing is saved", async () => {
    const r = await readSettings(answer(undefined));
    expect(r.settings).toEqual(defaultSettings());
    expect(r.source).toBe("default");
    expect(r.notice).toBeNull();
  });
  it("uses the defaults and says so when the saved text is broken", async () => {
    const r = await readSettings(answer("{oops"));
    expect(r.settings).toEqual(defaultSettings());
    expect(r.notice).toMatch(/Settings in the app/);
  });
  it("uses the defaults and says so when the read fails or throws", async () => {
    const failed = await readSettings(async () => ({ data: null, error: { message: "Access denied" } }));
    expect(failed.settings).toEqual(defaultSettings());
    expect(failed.notice).toContain("could not be read");
    const threw = await readSettings(async () => {
      throw new Error("boom");
    });
    expect(threw.settings).toEqual(defaultSettings());
    expect(threw.source).toBe("unreadable");
  });
  it("a partial answer with data is used", async () => {
    const r = await readSettings(async () => ({ data: { currentAppInstallation: { metafield: { value: serializeSettings(defaultSettings()) } } }, error: { message: "partial" } }));
    expect(r.source).toBe("saved");
  });
});
