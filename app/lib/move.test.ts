import { describe, expect, it } from "vitest";
import { planMove } from "./move";
import { GENERAL, makeShippers } from "./overview";
import type { Market, ProductRow, ProfileSummary } from "./types";

const profile = (id: string, countries: string[], extra: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id, name: id, isDefault: false, variantCount: 0, locationGroupIds: [], zoneIds: [], zones: [], countries,
  restOfWorld: false, unratedCountries: [], ratesKnown: true, rateCount: 2, zonesTruncated: false, ...extra,
});
const market = (id: string, codes: string[], cat: string): Market => ({
  id, name: id, status: "ACTIVE",
  countries: codes.map((code) => ({ code, name: code })),
  catalogs: [{ id: cat, title: cat, publicationId: `pub-${cat}` }],
});
const product = (id: string, cats: string[], status = "ACTIVE"): ProductRow => ({
  id, numericId: id, title: id, handle: id, vendor: "", productType: "", status, tags: [],
  catalogs: cats.map((c) => ({ id: c, title: c })), variantCount: 1,
});

const general = profile("general", [], { isDefault: true, restOfWorld: true });
const markets = [market("UK", ["GB"], "c-uk"), market("DE", ["DE"], "c-de"), market("CH", ["CH", "LI"], "c-ch")];
const shippers = makeShippers([general, profile("uk", ["GB"])]);
const ukProfile = shippers.find((s) => s.key === "uk")!;
const generalShipper = shippers.find((s) => s.key === GENERAL)!;

const run = (products: ProductRow[], target = ukProfile, mode: "full" | "unpublish" | "none" = "full", membership = {}) =>
  planMove({ products, membership, target, shippers, markets, mode });

describe("planMove to a UK-only profile", () => {
  const plan = run([product("a", ["c-uk", "c-de", "c-ch"]), product("b", [])]);
  it("moves shipping for both products", () => {
    expect(plan.totals.shipping).toBe(2);
    expect(plan.blocker).toBeNull();
  });
  it("unpublishes where the profile ships nowhere and publishes where it ships", () => {
    const a = plan.lines.find((l) => l.product.id === "a")!;
    expect(a.changes.map((c) => `${c.kind}:${c.market.id}`).sort()).toEqual(["unpublish:CH", "unpublish:DE"]);
    const b = plan.lines.find((l) => l.product.id === "b")!;
    expect(b.changes.map((c) => `${c.kind}:${c.market.id}`)).toEqual(["publish:UK"]);
  });
  it("counts effects per market", () => {
    expect(plan.perMarket.find((m) => m.coverage.market.id === "DE")).toMatchObject({ publish: 0, unpublish: 1 });
    expect(plan.totals).toMatchObject({ publish: 1, unpublish: 2 });
  });
});

describe("modes", () => {
  it("unpublish-only never publishes", () => {
    const plan = run([product("b", [])], ukProfile, "unpublish");
    expect(plan.totals.publish).toBe(0);
  });
  it("none leaves catalogues alone and warns", () => {
    const plan = run([product("a", ["c-de"])], ukProfile, "none");
    expect(plan.totals).toEqual({ shipping: 1, publish: 0, unpublish: 0 });
    expect(plan.warnings.join(" ")).toMatch(/Catalogues are not changed/);
  });
});

describe("edge cases", () => {
  it("moving to General publishes everywhere General ships (rest of world)", () => {
    const plan = run([product("a", ["c-uk"])], generalShipper, "full", { a: "uk" });
    expect(plan.lines[0]?.from).toBe("uk");
    expect(plan.lines[0]?.changes.map((c) => c.market.id).sort()).toEqual(["CH", "DE"]);
  });
  it("a product already in the profile with a correct catalogue set has nothing to change", () => {
    const plan = run([product("a", ["c-uk"])], ukProfile, "full", { a: "uk" });
    expect(plan.unchanged).toHaveLength(1);
    expect(plan.blocker).toMatch(/Nothing would change/);
  });
  it("still fixes visibility for a product already in the profile", () => {
    const plan = run([product("a", ["c-uk", "c-de"])], ukProfile, "full", { a: "uk" });
    expect(plan.lines[0]).toMatchObject({ shippingChange: false });
    expect(plan.totals).toMatchObject({ shipping: 0, unpublish: 1 });
  });
  it("blocks when the target has no shipping profile", () => {
    const target = { key: "x", name: "X", profile: null, kind: "profile" as const };
    expect(run([product("a", [])], target).blocker).toMatch(/no shipping profile/);
  });
  it("leaves catalogues of non-active products alone", () => {
    const plan = run([product("a", ["c-de"], "DRAFT")]);
    expect(plan.lines[0]?.changes).toEqual([]);
    expect(plan.warnings.join(" ")).toMatch(/not active/);
  });
  it("skips catalogues with no publication id", () => {
    const m = market("UK", ["GB"], "c-uk");
    m.catalogs = [{ id: "c-uk", title: "c-uk", publicationId: null }];
    const plan = planMove({ products: [product("a", [])], membership: {}, target: ukProfile, shippers, markets: [m], mode: "full" });
    expect(plan.totals.publish).toBe(0);
    expect(plan.warnings.join(" ")).toMatch(/skipped/);
  });
});

describe("fix helpers", () => {
  const ukOnly = shippers.find((s) => s.key === "uk")!;
  it("unpublish fix touches only the chosen market", async () => {
    const { planUnpublishFix } = await import("./fix");
    const plan = planUnpublishFix({
      products: [product("a", ["c-uk", "c-de", "c-ch"])],
      membership: { a: "uk" },
      target: ukOnly,
      shippers,
      markets,
      marketId: "DE",
    });
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]!.changes.map((c) => c.market.id)).toEqual(["DE"]);
    expect(plan.totals).toEqual({ shipping: 0, publish: 0, unpublish: 1 });
  });
  it("unpublish fix has a blocker when nothing is left", async () => {
    const { planUnpublishFix } = await import("./fix");
    const plan = planUnpublishFix({
      products: [product("a", ["c-uk"])],
      membership: { a: "uk" },
      target: ukOnly,
      shippers,
      markets,
      marketId: "DE",
    });
    expect(plan.blocker).toMatch(/Nothing to unpublish/);
  });
  it("country fix adds only missing countries and keeps the rest", async () => {
    const { planCountryFix, countryFixInput } = await import("./fix");
    const zone = { id: "z1", name: "Germany", locationGroupId: "lg1", countries: ["DE"], restOfWorld: false, rateCount: 1 };
    const fix = planCountryFix({ zones: [zone], zoneId: "z1", market: markets[2]!, shipsAlready: ["DE"] })!;
    expect(fix.add).toEqual(["CH", "LI"]);
    expect(fix.after).toEqual(["DE", "CH", "LI"]);
    const input = countryFixInput(fix);
    expect(input.locationGroupsToUpdate[0]!.zonesToUpdate[0]!.countries).toHaveLength(3);
  });
  it("country fix reports nothing to add", async () => {
    const { planCountryFix } = await import("./fix");
    const zone = { id: "z1", name: "z", locationGroupId: "lg1", countries: ["GB"], restOfWorld: false, rateCount: 1 };
    const fix = planCountryFix({ zones: [zone], zoneId: "z1", market: markets[0]!, shipsAlready: ["GB"] })!;
    expect(fix.blocker).toMatch(/already ships/);
  });
});
