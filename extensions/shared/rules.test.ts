import { describe, expect, it } from "vitest";
import { helperProduct, marketsFor, meta, realProduct, variant } from "../testkit/health";
import { fieldAlias } from "./facts";
import { detectProfile, evaluateHealth, titleMatches, type CheckResult } from "./rules";
import { defaultSettings, type BlockSettings } from "./settings";

const run = (facts = realProduct(), tweak?: (s: BlockSettings) => void, extra: Partial<Parameters<typeof evaluateHealth>[0]> = {}) => {
  const settings = defaultSettings();
  tweak?.(settings);
  return evaluateHealth({ facts, settings, markets: marketsFor(facts.publishedCatalogIds, settings), ...extra });
};
const get = (r: ReturnType<typeof run>, id: string): CheckResult | undefined => r.results.find((x) => x.id === id);
const a = (key: string) => fieldAlias({ namespace: "custom", key });

describe("profile detection", () => {
  const h = defaultSettings().helpers;
  it("a finished product is a real product", () => expect(detectProfile(realProduct(), h)).toMatchObject({ profile: "real" }));
  it("a finish is an option product, and says why", () => {
    const g = detectProfile(helperProduct(), h);
    expect(g.profile).toBe("option");
    expect(g.reason).toContain("Finishes");
  });
  it("tags and title patterns count, capitals do not", () => {
    expect(detectProfile(realProduct({ tags: ["Option"] }), h).profile).toBe("option");
    expect(detectProfile(realProduct({ title: "Rounded Edge" }), { ...h, titlePatterns: ["* edge"] }).profile).toBe("option");
    expect(detectProfile(realProduct({ title: "Edge table" }), { ...h, titlePatterns: ["* edge"] }).profile).toBe("real");
    expect(detectProfile(realProduct({ title: "Sample Leg Set" }), { ...h, titlePatterns: ["leg"] }).profile).toBe("option");
    expect(detectProfile(realProduct({ productType: "Bundles" }), h).profile).toBe("bundle");
  });
  it("matches a wildcard title", () => {
    expect(titleMatches("* finish", "Light Oak Finish")).toBe(true);
    expect(titleMatches("* finish", "Finish line table")).toBe(false);
    expect(titleMatches("", "x")).toBe(false);
  });
});

describe("a finished real product", () => {
  it("is ready with a full score and no pending rows", () => {
    const r = run();
    expect(r.profile).toBe("real");
    expect(r.verdict).toBe("Ready");
    expect(r.score).toBe(100);
    expect(r.counts).toEqual({ blocks: 0, hurts: 0, nice: 0 });
    expect(r.shown.every((x) => x.status === "pass")).toBe(true);
  });
  it("does not show a check that cannot apply", () => {
    const r = run();
    expect(r.shown.some((x) => x.status === "na")).toBe(false);
    expect(r.notApplicable).toBeGreaterThan(0); // typeList (no categories set), required_options (empty), seo.hidden (empty) ...
    expect(get(r, "basics.typeList")?.status).toBe("na");
  });
});

describe("a helper product is not nagged for content", () => {
  it("skips SEO, images and theme fields", () => {
    const r = run(helperProduct());
    expect(r.profile).toBe("option");
    const groups = new Set(r.results.map((x) => x.group));
    expect(groups.has("seo")).toBe(false);
    expect(groups.has("images")).toBe(false);
    expect(groups.has("theme")).toBe(false);
    expect(get(r, "basics.body")).toBeUndefined();
    expect(get(r, "basics.duplicateTitle")).toBeUndefined();
  });
  it("still checks the price and the markets", () => {
    const r = run(helperProduct({ publishedCatalogIds: [] }));
    expect(get(r, "markets.any")?.status).toBe("fail");
    expect(get(r, "markets.any")?.severity).toBe("blocks");
  });
  it("the view can change the guess locally", () => {
    const r = run(helperProduct(), undefined, { profile: "real" });
    expect(r.profile).toBe("real");
    expect(r.guess.profile).toBe("option");
    expect(get(r, "seo.title")?.status).toBe("fail");
  });
});

describe("Type", () => {
  it("flags a wood name and a missing type", () => {
    for (const type of ["Ash", "American Walnut", "oak", "all_materials"]) {
      const r = run(realProduct({ productType: type }));
      expect(get(r, "basics.typeWood")?.status, type).toBe("fail");
      expect(get(r, "basics.typeWood")?.reason).toContain("wood or material name");
    }
    const none = run(realProduct({ productType: "" }));
    expect(get(none, "basics.type")?.status).toBe("fail");
    expect(get(none, "basics.typeWood")).toMatchObject({ status: "na" });
  });
  it("checks the expected list only when there is one", () => {
    const r = run(realProduct({ productType: "Table" }), (s) => void (s.helpers.expectedCategories = ["Chairs", "Tables"]));
    expect(get(r, "basics.typeList")).toMatchObject({ status: "fail", severity: "nice" });
    expect(get(run(realProduct({ productType: "tables" }), (s) => void (s.helpers.expectedCategories = ["Chairs", "Tables"])), "basics.typeList")?.status).toBe("pass");
  });
});

describe("SEO", () => {
  it("empty, too long, too short", () => {
    const empty = run(realProduct({ seoTitle: "", seoDescription: "" }));
    expect(get(empty, "seo.title")?.status).toBe("fail");
    expect(get(empty, "seo.desc")?.status).toBe("fail");
    expect(get(empty, "seo.titleLength")?.status).toBe("na");
    const long = run(realProduct({ seoTitle: "x".repeat(70), seoDescription: "y".repeat(200) }));
    expect(get(long, "seo.titleLength")?.reason).toContain("70 characters");
    expect(get(long, "seo.descLength")?.reason).toContain("200 characters");
    const short = run(realProduct({ seoDescription: "Too short" }));
    expect(get(short, "seo.descLength")?.reason).toContain("aim for 50 to 160");
  });
  it("uses the thresholds from the settings", () => {
    const r = run(realProduct({ seoTitle: "x".repeat(70) }), (s) => void (s.thresholds.seoTitleMax = 80));
    expect(get(r, "seo.titleLength")?.status).toBe("pass");
  });
});

describe("Images", () => {
  it("shows alt coverage and the first five images without alt text", () => {
    const images = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, alt: i < 3 ? "alt" : "" }));
    const c = get(run(realProduct({ images })), "images.alt")!;
    expect(c.status).toBe("fail");
    expect(c.reason).toBe("3 of 20 images have alt text (target 100%).");
    expect(c.items).toEqual(["Image 4", "Image 5", "Image 6", "Image 7", "Image 8"]);
    expect(c.link?.href).toBe("shopify:admin/products/9001#media");
  });
  it("passes when the target is lower", () => {
    const images = Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, alt: i < 8 ? "alt" : "" }));
    expect(get(run(realProduct({ images }), (s) => void (s.thresholds.altTarget = 80)), "images.alt")?.status).toBe("pass");
  });
  it("fails with no images", () => {
    const r = run(realProduct({ images: [] }));
    expect(get(r, "images.count")?.status).toBe("fail");
    expect(get(r, "images.alt")?.status).toBe("na");
  });
});

describe("Variants and pricing", () => {
  it("finds the trailing space in a variant title", () => {
    const r = run(realProduct({ variants: [variant({ title: "Oak / 180 " }), variant({ id: "gid://shopify/ProductVariant/2", title: "Oak  / 200" })] }));
    const c = get(r, "variants.spaces")!;
    expect(c.status).toBe("fail");
    expect(c.reason).toContain('"Oak / 180 "');
    expect(c.link?.href).toBe("shopify:admin/products/9001/variants/1");
  });
  it("weight 0, empty SKU, empty cost: counted per variant", () => {
    const r = run(realProduct({ variants: [variant({ weight: 0, sku: "", cost: null }), variant({ id: "gid://shopify/ProductVariant/2", title: "b" })] }));
    expect(get(r, "variants.weight")?.reason).toBe("1 of 2 variants has no weight.");
    expect(get(r, "variants.sku")?.status).toBe("fail");
    expect(get(r, "variants.cost")?.severity).toBe("nice");
  });
  it("compare-at equal to or below the price", () => {
    const r = run(realProduct({ variants: [variant({ price: 100, compareAt: 100 }), variant({ id: "gid://shopify/ProductVariant/2", price: 100, compareAt: 80 }), variant({ id: "gid://shopify/ProductVariant/3", price: 100, compareAt: null })] }));
    expect(get(r, "variants.compareEqual")?.reason).toContain("1 variant");
    expect(get(r, "variants.compareLower")?.status).toBe("fail");
  });
  it("a price of zero blocks the storefront", () => {
    const c = get(run(realProduct({ variants: [variant({ price: 0 })] })), "variants.price")!;
    expect(c.status).toBe("fail");
    expect(c.severity).toBe("blocks");
  });
  it("variant without an image only counts when other variants have one", () => {
    expect(get(run(realProduct({ variants: [variant({ hasImage: false }), variant({ id: "gid://shopify/ProductVariant/2" })] })), "variants.image")?.status).toBe("fail");
    expect(get(run(realProduct({ variants: [variant({ hasImage: false })] })), "variants.image")?.status).toBe("na");
  });
  it("a duplicate option value after trimming", () => {
    const r = run(realProduct({ options: [{ name: "Wood", values: ["Oak", "oak "] }] }));
    expect(get(r, "variants.dupValues")?.reason).toContain('Wood: "oak "');
  });
  it("says 'could not be read' instead of guessing when the variant details are missing", () => {
    const facts = realProduct();
    facts.read.variantExtras = "failed";
    const r = run(facts);
    expect(get(r, "variants.sku")?.status).toBe("unknown");
    expect(r.shown.find((x) => x.id === "variants.sku")?.reason).toBe("Could not be read.");
    expect(r.counted).toBeLessThan(run().counted);
  });
});

describe("duplicate titles", () => {
  it("names the other products", () => {
    const c = get(run(realProduct({ duplicates: [{ handle: "maya-table-2", title: "Maya Dining Table" }, { handle: "maya-table-3", title: "Maya Dining Table" }] })), "basics.duplicateTitle")!;
    expect(c.reason).toBe("Same title as 2 other products: maya-table-2, maya-table-3.");
  });
  it("is unknown when the lookup failed", () => {
    const f = realProduct();
    f.read.duplicates = "failed";
    expect(get(run(f), "basics.duplicateTitle")?.status).toBe("unknown");
  });
});

describe("theme fields", () => {
  it("wood type and material title must match; capitals only is said", () => {
    const f = realProduct();
    f.fields[a("product_wood_type")] = meta("oak");
    const c = get(run(f), "theme:tf:custom.product_wood_type~material-main-title")!;
    expect(c.status).toBe("fail");
    expect(c.reason).toContain("differ in capitals only");
    f.fields[a("product_wood_type")] = meta("Ash");
    expect(get(run(f), "theme:tf:custom.product_wood_type~material-main-title")?.reason).toContain("does not match");
  });
  it("wood type with extra spaces fails the clean rule", () => {
    const f = realProduct();
    f.fields[a("product_wood_type")] = meta("American  Walnut ");
    expect(get(run(f), "theme:tf:custom.product_wood_type")?.status).toBe("fail");
  });
  it("seo.hidden flags a stray quote", () => {
    const f = realProduct();
    f.fields[fieldAlias({ namespace: "seo", key: "hidden" })] = meta("'0");
    const c = get(run(f), "theme:tf:seo.hidden")!;
    expect(c.status).toBe("fail");
    expect(c.reason).toContain(`"'0"`);
    for (const ok of ["true", "false", "0", "1"]) {
      f.fields[fieldAlias({ namespace: "seo", key: "hidden" })] = meta(ok);
      expect(get(run(f), "theme:tf:seo.hidden")?.status).toBe("pass");
    }
  });
  it("related products must exist, be published and not be this product", () => {
    const f = realProduct();
    f.fields[a("hd_related_products")] = meta("ghost, maya-dining-table, unpublished-one");
    f.linked[a("hd_related_products")] = [
      { token: "ghost", handle: "ghost", found: false, status: null, published: false, self: false },
      { token: "maya-dining-table", handle: "maya-dining-table", found: true, status: "ACTIVE", published: true, self: true },
      { token: "unpublished-one", handle: "unpublished-one", found: true, status: "ACTIVE", published: false, self: false },
    ];
    const c = get(run(f), "theme:tf:custom.hd_related_products")!;
    expect(c.status).toBe("fail");
    expect(c.items).toEqual(["ghost does not exist", "maya-dining-table is this product", "unpublished-one is not published"]);
  });
  it("required options only need to exist", () => {
    const f = realProduct();
    f.fields[a("required_options")] = meta("finish-1");
    f.linked[a("required_options")] = [{ token: "finish-1", handle: "finish-1", found: true, status: "DRAFT", published: false, self: false }];
    expect(get(run(f), "theme:tf:custom.required_options")?.status).toBe("pass");
  });
  it("a field switched off, or not required for this kind of product, is not run", () => {
    expect(get(run(realProduct(), (s) => void (s.themeFields[0]!.on = false)), "theme:tf:custom.tag_line")).toBeUndefined();
    expect(get(run(realProduct({ productType: "Bundles" })), "theme:tf:custom.product_wood_type")).toBeUndefined();
  });
  it("the length and seater check still works from the old settings", () => {
    const s = defaultSettings();
    const r = run(realProduct({ variants: [variant({ fields: { [a("variant_length")]: meta("180") } })] }), undefined);
    expect(get(r, "theme.lengthSeater")?.status).toBe("fail");
    expect(get(r, "theme.lengthSeater")?.reason).toContain("Seater is empty on 1 of 1 variant");
    expect(s.quality.fields.length).toHaveLength(1);
  });
  it("a custom 'metafield must not be empty' check runs in the theme group", () => {
    const r = run(realProduct(), (s) => void s.quality.checks.push({ id: "mf:product:custom.care", kind: "metafield", label: "Care text filled", on: true, field: { label: "Care", namespace: "custom", key: "care", owner: "product" } }));
    const c = get(r, "theme.custom:mf:product:custom.care");
    expect(c?.status).toBe("fail");
    expect(c?.label).toBe("Care text filled");
  });
});

describe("markets", () => {
  it("maya-chair-1 is not published to Switzerland: a warning, because the main market has it", () => {
    const facts = realProduct({ handle: "maya-chair-1", publishedCatalogIds: ["cat_uk", "cat_us", "cat_fr", "cat_de", "cat_nl"] });
    const c = get(run(facts), "markets.spread")!;
    expect(c.status).toBe("fail");
    expect(c.severity).toBe("hurts");
    expect(c.reason).toBe("Published in 5 of 6 markets; not in CH.");
  });
  it("is only information when the main market does not have it either", () => {
    const facts = realProduct({ publishedCatalogIds: ["cat_us", "cat_fr"] });
    expect(get(run(facts), "markets.spread")?.severity).toBe("nice");
  });
  it("blocks the storefront when it is in no market", () => {
    const r = run(realProduct({ publishedCatalogIds: [] }));
    expect(get(r, "markets.any")).toMatchObject({ status: "fail", severity: "blocks" });
    expect(get(r, "markets.spread")?.status).toBe("na");
    expect(r.verdict).toBe("1 to fix before launch");
  });
});

describe("score and verdict", () => {
  it("weights the failures by severity", () => {
    const facts = realProduct({ publishedCatalogIds: [] }); // one blocks failure, weight 3
    const r = run(facts);
    expect(r.counted).toBe(r.passed + 1);
    const total = r.results.filter((x) => x.status !== "na").reduce((n, x) => n + ({ blocks: 3, hurts: 2, nice: 1 }[x.severity]), 0);
    expect(r.score).toBe(Math.round(((total - 3) / total) * 100));
  });
  it("groups the pending list by severity", () => {
    const r = run(realProduct({ seoDescription: "", publishedCatalogIds: [], variants: [variant({ sku: "" })] }));
    expect(r.pending.blocks.map((x) => x.id)).toEqual(["markets.any"]);
    expect(r.pending.hurts.map((x) => x.id)).toContain("seo.desc");
    expect(r.pending.nice.map((x) => x.id)).toContain("variants.sku");
    expect(r.counts).toEqual({ blocks: 1, hurts: 1, nice: 1 });
  });
  it("says Ready with nice-to-haves when only those are left", () => {
    expect(run(realProduct({ variants: [variant({ sku: "" })] })).verdict).toBe("Ready, 1 nice to have");
  });
});

describe("groups, profiles and single checks", () => {
  it("a group switched off disappears", () => {
    const r = run(realProduct(), (s) => void (s.groups.groups.seo = false));
    expect(r.results.some((x) => x.group === "seo")).toBe(false);
  });
  it("the profile table decides per kind of product", () => {
    const r = run(helperProduct(), (s) => void (s.groups.profiles.option.seo = true));
    expect(r.results.some((x) => x.group === "seo")).toBe(true);
  });
  it("a single check can be switched off", () => {
    const r = run(realProduct({ seoDescription: "" }), (s) => void (s.groups.disabledRules = ["seo.desc"]));
    expect(get(r, "seo.desc")).toBeUndefined();
  });
});

describe("linked records", () => {
  const obj = (over: Record<string, unknown>) => ({ id: "gid://shopify/Metaobject/5", type: "swatches", handle: "oak", displayName: "Oak", status: "ACTIVE" as const, fields: { group: "Wood", group_key: "wood", group_priority: "1" }, ...over });
  const withSwatch = () => realProduct({ variants: [variant({ fields: { [a("swatches_test")]: meta("gid://shopify/Metaobject/5", "metaobject_reference") } })] });
  const records = (o: ReturnType<typeof obj>) => ({ state: "ok" as const, message: "", linked: { [o.id]: o }, delivery: null });

  it("a healthy swatch passes", () => expect(get(run(withSwatch(), undefined, { records: records(obj({})) }), "linked.swatches")?.status).toBe("pass"));
  it("flags a draft, an empty group_key and a test name", () => {
    const r = run(withSwatch(), undefined, { records: records(obj({ status: "DRAFT", displayName: "Test 3", fields: { group: "Group 1", group_key: "" } })) });
    const c = get(r, "linked.swatches")!;
    expect(c.status).toBe("fail");
    expect(c.reason).toContain("is a draft");
    expect(c.reason).toContain("no group key");
    expect(c.reason).toContain("test data");
    expect(c.link?.href).toBe("shopify:admin/content/metaobjects/entries/swatches/5");
  });
  it("is unknown when the metaobject permission is missing", () => {
    const r = run(withSwatch(), undefined, { records: { state: "failed", message: "Access denied", linked: {}, delivery: null } });
    expect(get(r, "linked.swatches")?.status).toBe("unknown");
  });
  it("finds an ACTIVE delivery record for the wood, and fails on a draft or none", () => {
    const f = realProduct();
    const delivery = (status: "ACTIVE" | "DRAFT") => ({ state: "ok" as const, message: "", linked: {}, delivery: [obj({ id: "gid://shopify/Metaobject/9", type: "build_and_delivery_time", displayName: "Oak", status })] });
    expect(get(run(f, undefined, { records: delivery("ACTIVE") }), "linked.delivery")?.status).toBe("pass");
    expect(get(run(f, undefined, { records: delivery("DRAFT") }), "linked.delivery")?.reason).toContain("is a draft");
    f.fields[a("product_wood_type")] = meta("Walnut");
    f.fields[a("material-main-title")] = meta("Walnut");
    f.productType = "Tables";
    expect(get(run(f, undefined, { records: delivery("ACTIVE") }), "linked.delivery")?.reason).toContain("No delivery-time record");
  });
  it("is not shown at all when the records were never asked for", () => expect(get(run(withSwatch()), "linked.swatches")).toBeUndefined());
  it("an empty record type switches the checks off", () => {
    expect(get(run(withSwatch(), (s) => void (s.records.swatchType = ""), { records: records(obj({})) }), "linked.swatches")).toBeUndefined();
  });
});
