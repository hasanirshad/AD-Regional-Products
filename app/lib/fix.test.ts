import { describe, expect, it } from "vitest";
import { affectedLines, countryFixInput, defaultZoneId, planCountryFix, ratedZones, zoneDrift, zoneMissing } from "./fix";
import { buildOverview } from "./overview";
import { market, product, profile, zone } from "./testkit";

const ch = market("CH", ["CH", "LI"]);

describe("zones for the countries fix", () => {
  const rated = zone("rated", ["DE"], 2);
  const bare = zone("bare", ["CH"], 0);
  it("only offers zones that have rates", () => {
    expect(ratedZones([rated, bare]).map((z) => z.id)).toEqual(["rated"]);
    expect(ratedZones([zone("u", ["DE"], null)]).map((z) => z.id)).toEqual(["u"]);
  });
  it("defaults to the rated zone that already holds most of the market", () => {
    const a = zone("a", ["DE"], 1);
    const b = zone("b", ["CH"], 1);
    expect(defaultZoneId([a, b], ch)).toBe("b");
    expect(defaultZoneId([bare, a], ch)).toBe("a");
    expect(defaultZoneId([bare], ch)).toBe("");
  });
  it("plans nothing when no zone has rates", () => {
    expect(planCountryFix({ zones: [bare], zoneId: "bare", market: ch, shipsAlready: [] })).toBeNull();
  });
  it("adds only countries that are in no zone, and tells about those stuck in an unrated zone", () => {
    const fix = planCountryFix({ zones: [rated, zone("bare", ["LI"], 0)], zoneId: "rated", market: ch, shipsAlready: ["DE"], unrated: ["LI"] })!;
    expect(fix.add).toEqual(["CH"]);
    expect(fix.needRates).toEqual(["LI"]);
    expect(fix.after).toEqual(["DE", "CH"]);
    expect(fix.blocker).toBeNull();
  });
  it("is blocked, with a reason, when everything missing is in an unrated zone", () => {
    const fix = planCountryFix({ zones: [rated], zoneId: "rated", market: ch, shipsAlready: [], unrated: ["CH", "LI"] })!;
    expect(fix.add).toEqual([]);
    expect(fix.blocker).toMatch(/no rates/);
  });
  it("keeps rest of world in the input when the zone has it", () => {
    const row = zone("row", ["DE"], 1, { restOfWorld: true });
    const fix = planCountryFix({ zones: [row], zoneId: "row", market: ch, shipsAlready: ["DE"] })!;
    const sent = countryFixInput(fix).locationGroupsToUpdate[0]!.zonesToUpdate[0]!.countries;
    expect(sent).toContainEqual({ restOfWorld: true });
    expect(sent).toContainEqual({ code: "CH", includeAllProvinces: true });
  });
});

describe("recheck and read-back of a zone", () => {
  const z = zone("z1", ["DE"], 1);
  const fix = planCountryFix({ zones: [z], zoneId: "z1", market: ch, shipsAlready: ["DE"] })!;
  const fresh = (zones = [z]) => profile("p", ["DE"], { zones });
  it("sees no drift when the zone is as reviewed", () => {
    expect(zoneDrift(fresh(), fix)).toBeNull();
  });
  it("sees drift when the zone changed, lost its rates, or vanished", () => {
    expect(zoneDrift(fresh([zone("z1", ["DE", "AT"], 1)]), fix)).toMatch(/countries changed/);
    expect(zoneDrift(fresh([zone("z1", ["DE"], 0)]), fix)).toMatch(/no active rates/);
    expect(zoneDrift(fresh([]), fix)).toMatch(/not found/);
    expect(zoneDrift(null, fix)).toMatch(/profile was not found/);
  });
  it("read-back lists the countries Shopify still does not show", () => {
    expect(zoneMissing(fresh([zone("z1", ["DE", "CH", "LI"], 1)]), fix)).toEqual([]);
    expect(zoneMissing(fresh([zone("z1", ["DE", "CH"], 1)]), fix)).toEqual(["LI"]);
    expect(zoneMissing(fresh(), fix)).toEqual(["CH", "LI"]);
  });
});

describe("affectedLines", () => {
  it("leaves out split products and other states", () => {
    const general = profile("general", [], { isDefault: true, restOfWorld: true });
    const uk = profile("uk", ["GB"]);
    const de = market("DE", ["DE"]);
    const o = buildOverview({
      markets: [de],
      profiles: [general, uk],
      rows: [product("a", ["c-DE"]), product("b", ["c-DE"], "ACTIVE", 2)],
      membership: { a: "uk", b: "uk" },
      parts: { a: [{ key: "uk", variants: 1 }], b: [{ key: "uk", variants: 1 }, { key: "__general__", variants: 1 }] },
    });
    expect(affectedLines(o.lines, "uk", "DE", "blocked").map((l) => l.product.id)).toEqual(["a"]);
    expect(affectedLines(o.lines, "uk", "DE", "partial")).toEqual([]);
  });
});
