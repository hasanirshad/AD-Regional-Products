import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings, serializeSettings } from "../../../extensions/shared/settings";
import { applyProposals, proposeFromStore, readStoreExtras, type StoreFacts } from "./detect";
import type { Gql } from "./gql";

const d = (namespace: string, key: string) => ({ namespace, key, name: key });
const facts = (over: Partial<StoreFacts> = {}): StoreFacts => ({
  productDefs: ["tag_line", "product_wood_type", "material-main-title", "hd_related_products", "hd_recommended_products", "stock_delivery", "design_customisation", "required_options"].map((k) => d("custom", k)),
  variantDefs: [d("custom", "variant_length"), d("custom", "swatches_test"), d("custom", "hide_from_markets")],
  metaobjectDefs: [
    { type: "swatches", name: "Swatches", fieldKeys: ["group"] },
    { type: "build_and_delivery_time", name: "Build and Delivery time", fieldKeys: [] },
    { type: "design_customisation", name: "Design & Customisation", fieldKeys: [] },
  ],
  productTypes: ["Tables", "Chairs", "oak", "Finishes", "", "Walnut"],
  locales: [{ locale: "en", name: "English", primary: true, published: true }, { locale: "fr", name: "French", primary: false, published: true }, { locale: "de", name: "German", primary: false, published: true }],
  markets: [{ id: "gid://shopify/Market/1", name: "United Kingdom", countries: ["GB"] }],
  ...over,
});
const ids = (p: { proposals: { id: string }[] }) => p.proposals.map((x) => x.id);

describe("Detect from this store", () => {
  it("proposes the Types in use as categories, leaves out wood names and files finishes as option products", () => {
    const found = proposeFromStore(defaultSettings(), facts());
    expect(ids(found)).toContain("categories");
    expect(ids(found)).not.toContain("helperTypes"); // "Finishes" is already a helper type in the defaults
    const next = applyProposals(defaultSettings(), found.proposals.filter((p) => p.id === "categories"));
    expect(next.helpers.expectedCategories).toEqual(["Tables", "Chairs"]);
    const catLines = found.proposals.find((p) => p.id === "categories")!.lines.join(" ");
    expect(catLines).toContain("oak");
    expect(catLines).toContain("Walnut");
  });
  it("adds a helper Type that looks like an option product", () => {
    const s = defaultSettings();
    s.helpers.types = [];
    const found = proposeFromStore(s, facts());
    expect(ids(found)).toContain("helperTypes");
    expect(applyProposals(s, found.proposals.filter((p) => p.id === "helperTypes")).helpers.types).toEqual(["Finishes"]);
  });
  it("switches off theme fields the store does not have, and never the built-in seo field", () => {
    const found = proposeFromStore(defaultSettings(), facts({ productDefs: [d("custom", "tag_line")] }));
    const p = found.proposals.find((x) => x.id === "themeFields")!;
    expect(p.lines.length).toBeGreaterThan(5);
    const next = applyProposals(defaultSettings(), [p]);
    expect(next.themeFields.find((f) => f.key === "tag_line")!.on).toBe(true);
    expect(next.themeFields.find((f) => f.key === "stock_delivery")!.on).toBe(false);
    expect(next.themeFields.find((f) => f.namespace === "seo")!.on).toBe(true);
  });
  it("finds nothing to change when the store matches the defaults", () => {
    const s = defaultSettings();
    s.helpers.expectedCategories = ["Tables", "Chairs"];
    s.markets = s.markets.filter((m) => m.country === "GB");
    s.languages = [{ code: "fr", label: "French" }, { code: "de", label: "German" }];
    s.markets.forEach((m) => (m.locale = ""));
    const found = proposeFromStore(s, facts());
    expect(found.proposals).toEqual([]);
  });
  it("picks the metaobject types by name and clears a type the store does not have", () => {
    const s = defaultSettings();
    const found = proposeFromStore(s, facts({ metaobjectDefs: [{ type: "swatch_colours", name: "Swatch colours", fieldKeys: [] }] }));
    const p = found.proposals.find((x) => x.id === "recordTypes")!;
    const next = applyProposals(s, [p]);
    expect(next.records.swatchType).toBe("swatch_colours");
    expect(next.records.deliveryType).toBe("");
    expect(next.records.designType).toBe("");
  });
  it("proposes the variant metafields by key when the default ones do not exist", () => {
    const found = proposeFromStore(defaultSettings(), facts({ variantDefs: [d("custom", "swatch_ref"), d("custom", "hide_markets")] }));
    const next = applyProposals(defaultSettings(), found.proposals.filter((p) => p.id === "recordFields"));
    expect(next.records.swatchField).toMatchObject({ key: "swatch_ref", owner: "variant" });
    expect(next.records.hideField).toMatchObject({ key: "hide_markets", owner: "variant" });
  });
  it("lists a store market the blocks do not know and gives it a free short code", () => {
    const s = defaultSettings();
    const found = proposeFromStore(s, facts({ markets: [{ id: "m9", name: "Austria", countries: ["AT"] }, { id: "m1", name: "United Kingdom", countries: ["GB"] }] }));
    const next = applyProposals(s, found.proposals.filter((p) => p.id === "markets"));
    expect(next.markets.at(-1)).toMatchObject({ key: "AT", label: "Austria", country: "AT", domain: "", enabled: true });
    expect(next.markets).toHaveLength(s.markets.length + 1);
  });
  it("clears a market language the store does not publish", () => {
    const found = proposeFromStore(defaultSettings(), facts({ locales: [{ locale: "en", name: "English", primary: true, published: true }, { locale: "fr", name: "French", primary: false, published: true }] }));
    const next = applyProposals(defaultSettings(), found.proposals.filter((p) => p.id === "marketLocales"));
    expect(next.markets.find((m) => m.key === "DE")!.locale).toBe("");
    expect(next.markets.find((m) => m.key === "FR")!.locale).toBe("fr");
  });
  it("says what it could not read and leaves those settings alone", () => {
    const found = proposeFromStore(defaultSettings(), facts({ metaobjectDefs: null, productTypes: null, productDefs: null }));
    expect(found.notes.join(" ")).toMatch(/theme fields could not be checked/);
    expect(found.notes.join(" ")).toMatch(/Metaobjects were not read/);
    expect(found.notes.join(" ")).toMatch(/product Types were not read/);
    expect(ids(found)).not.toContain("recordTypes");
    expect(ids(found)).not.toContain("categories");
  });
  it("adding proposals changes the draft only: the result is still valid settings", () => {
    const s = defaultSettings();
    const found = proposeFromStore(s, facts({ markets: [{ id: "m9", name: "Austria", countries: ["AT"] }] }));
    const next = applyProposals(s, found.proposals);
    // A market without a domain cannot be saved yet: the Quick links tab asks for it.
    expect(parseSettings(serializeSettings(next)).problems.join(" ")).toContain("storefront domain");
    next.markets.find((m) => m.key === "AT")!.domain = "hardman.at";
    expect(parseSettings(serializeSettings(next)).source).toBe("saved");
    expect(s.markets.some((m) => m.key === "AT")).toBe(false); // the original is untouched
  });
});

describe("the two reads of Detect never throw", () => {
  it("reads metaobject definitions and product Types", async () => {
    const gql: Gql = async <T,>(q: string) =>
      (q.includes("metaobjectDefinitions")
        ? { metaobjectDefinitions: { nodes: [{ type: "swatches", name: "Swatches", fieldDefinitions: [{ key: "group" }] }] } }
        : { productTypes: { nodes: ["Tables", "Chairs"] } }) as T;
    const r = await readStoreExtras(gql);
    expect(r.metaobjectDefs).toEqual([{ type: "swatches", name: "Swatches", fieldKeys: ["group"] }]);
    expect(r.productTypes).toEqual(["Tables", "Chairs"]);
    expect(r.notes).toEqual([]);
  });
  it("a refused read gives null and a plain note naming the permission", async () => {
    const gql: Gql = async () => {
      throw new Error("Access denied for metaobjectDefinitions field.");
    };
    const r = await readStoreExtras(gql);
    expect(r.metaobjectDefs).toBeNull();
    expect(r.productTypes).toBeNull();
    expect(r.notes[0]).toContain("read_metaobject_definitions");
    expect(r.notes).toHaveLength(2);
  });
});
