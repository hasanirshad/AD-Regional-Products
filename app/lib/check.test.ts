import { describe, expect, it } from "vitest";
import { buildProductCheck, type ProductDetail } from "./check";
import { GENERAL } from "./keys";
import { market, profile, zone } from "./testkit";

const general = profile("general", ["GB"], { isDefault: true, name: "General" });
const dhl = profile("dhl", ["DE", "FR"], { name: "DE-DHL", zones: [zone("z1", ["DE", "FR"], 2)] });
const uk = profile("uk", ["GB"], { name: "UK", zones: [zone("z2", ["GB"], 1)] });
const markets = [market("UK", ["GB"]), market("DE", ["DE"]), market("FR", ["FR"]), market("NL", ["NL"], ["c-NL"], "ACTIVE")];

const detail = (over: Partial<ProductDetail> = {}, profileKeys: string[] = ["dhl"]): ProductDetail => ({
  id: "gid://shopify/Product/1",
  numericId: "1",
  title: "Oak table",
  status: "ACTIVE",
  catalogs: [{ id: "c-DE", title: "c-DE" }, { id: "c-NL", title: "c-NL" }],
  variants: profileKeys.map((k, i) => ({ id: `v${i}`, title: `Variant ${i}`, sku: `SKU${i}`, profileKey: k })),
  variantsComplete: true,
  variantTotal: profileKeys.length,
  ...over,
});
const check = (d: ProductDetail) => buildProductCheck({ detail: d, markets, profiles: [general, dhl, uk] });

describe("Product check: the chain", () => {
  const c = check(detail());
  const byName = (n: string) => c.markets.find((m) => m.name === n)!;
  it("separates 'can be bought' from 'visible but cannot check out' from 'not visible'", () => {
    expect(byName("DE").result).toBe("buy"); // published + DHL ships to DE
    expect(byName("NL").result).toBe("cannot"); // published, DHL does not ship to NL
    expect(byName("NL").reason).toContain("DE-DHL does not ship there");
    expect(byName("FR").result).toBe("hidden"); // ships, but not in the catalogue
    expect(byName("FR").reason).toMatch(/not in this market's catalogue/);
    expect(byName("UK").result).toBe("hidden");
  });
  it("lists every country with visible / checkout / result", () => {
    const nl = c.countries.find((x) => x.code === "NL")!;
    expect(nl).toMatchObject({ visible: true, checkout: false, result: "cannot" });
    const fr = c.countries.find((x) => x.code === "FR")!;
    expect(fr).toMatchObject({ visible: false, checkout: true, result: "hidden" });
  });
  it("lists catalogues and whether the product is in each", () => {
    expect(c.catalogs.map((x) => [x.id, x.inIt])).toEqual([["c-UK", false], ["c-DE", true], ["c-FR", false], ["c-NL", true]]);
  });
  it("lists every profile, General too, with the product's variants in them", () => {
    expect(c.profiles.map((p) => p.name)).toEqual(["General", "DE-DHL", "UK"]);
    expect(c.profiles.find((p) => p.key === "dhl")!.variants).toBe(1);
    expect(c.profiles.find((p) => p.isGeneral)!.variants).toBe(0);
  });
  it("the headline names the markets that are visible but cannot check out", () => {
    expect(c.headline.tone).toBe("critical");
    expect(c.headline.text).toMatch(/can be bought in DE/i);
    expect(c.headline.text).toMatch(/cannot check out in NL/);
    expect(c.split).toBe(false);
    expect(c.variants).toEqual([]);
  });
});

describe("Product check: statuses", () => {
  it("a draft is not visible anywhere, whatever its catalogues say", () => {
    const c = check(detail({ status: "DRAFT" }));
    expect(c.markets.every((m) => m.result === "hidden")).toBe(true);
    expect(c.headline.text).toMatch(/Draft/);
  });
  it("an inactive market is not visible", () => {
    const c = buildProductCheck({ detail: detail(), markets: [market("DE", ["DE"], ["c-DE"], "DRAFT")], profiles: [general, dhl] });
    expect(c.markets[0]).toMatchObject({ result: "hidden", reason: "The market is not active." });
  });
  it("says so when it can be bought everywhere", () => {
    const only = buildProductCheck({ detail: detail(), markets: [markets[1]!], profiles: [general, dhl] });
    expect(only.headline).toMatchObject({ tone: "success" });
  });
  it("a zone with countries but no rate does not count as shipping", () => {
    const bare = profile("dhl", ["FR"], { name: "DE-DHL", unratedCountries: ["DE"], zones: [zone("z1", ["FR"], 1), zone("z2", ["DE"], 0)] });
    const c = buildProductCheck({ detail: detail(), markets: [markets[1]!], profiles: [general, bare] });
    expect(c.markets[0]!.result).toBe("cannot");
    expect(c.markets[0]!.reason).toMatch(/zone with no rates/);
  });
});

describe("Product check: variants that differ", () => {
  const c = check(detail({}, ["dhl", "uk"]));
  it("is split, with a note, and a table per variant", () => {
    expect(c.split).toBe(true);
    expect(c.notes[0]).toMatch(/different shipping profiles/);
    expect(c.variants.map((v) => v.profileName)).toEqual(["DE-DHL", "UK"]);
  });
  it("each variant shows where its own profile ships", () => {
    const de = markets[1]!.id;
    expect(c.variants[0]!.perMarket[de]).toBe("all");
    expect(c.variants[1]!.perMarket[de]).toBe("none");
  });
  it("a country can buy only where EVERY variant's profile ships", () => {
    expect(c.markets.find((m) => m.name === "DE")!.result).toBe("cannot");
    expect(c.markets.find((m) => m.name === "DE")!.reason).toContain("UK does not ship there");
  });
  it("variants in General only are not split", () => {
    expect(check(detail({}, [GENERAL, GENERAL])).split).toBe(false);
  });
});
