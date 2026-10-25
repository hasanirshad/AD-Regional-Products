import { describe, expect, it } from "vitest";
import { deriveShipping, parseProfileItems, parseZoneRates, withZoneRates } from "./parse";
import { profile, zone } from "./testkit";

describe("deriveShipping", () => {
  it("ignores zones that have no rate", () => {
    const d = deriveShipping([zone("z1", ["DE"], 2), zone("z2", ["FR", "NL"], 0)]);
    expect(d.countries).toEqual(["DE"]);
    expect(d.unratedCountries).toEqual(["FR", "NL"]);
  });
  it("treats unknown rates as rated", () => {
    expect(deriveShipping([zone("z1", ["DE"], null)]).countries).toEqual(["DE"]);
  });
  it("a country in a rated and an unrated zone ships", () => {
    const d = deriveShipping([zone("z1", ["DE"], 1), zone("z2", ["DE"], 0)]);
    expect(d.countries).toEqual(["DE"]);
    expect(d.unratedCountries).toEqual([]);
  });
  it("rest of world only counts when its zone has rates", () => {
    expect(deriveShipping([zone("z", [], 0, { restOfWorld: true })]).restOfWorld).toBe(false);
    expect(deriveShipping([zone("z", [], 3, { restOfWorld: true })]).restOfWorld).toBe(true);
  });
});

describe("zone rates", () => {
  it("counts only active methods per zone", () => {
    expect(
      parseZoneRates({
        deliveryProfile: {
          profileLocationGroups: [
            {
              locationGroupZones: {
                nodes: [
                  { zone: { id: "z1" }, methodDefinitions: { nodes: [{ active: true }, { active: false }] } },
                  { zone: { id: "z2" }, methodDefinitions: { nodes: [{ active: false }] } },
                ],
              },
            },
          ],
        },
      }),
    ).toEqual({ z1: 1, z2: 0 });
  });
  it("withZoneRates recomputes the shipping countries and marks rates as known", () => {
    const p = profile("p", ["DE", "FR"], { ratesKnown: false, zones: [zone("z1", ["DE"], null), zone("z2", ["FR"], null)] });
    const out = withZoneRates(p, { z1: 1, z2: 0 });
    expect(out.ratesKnown).toBe(true);
    expect(out.countries).toEqual(["DE"]);
    expect(out.unratedCountries).toEqual(["FR"]);
  });
});

describe("parseProfileItems", () => {
  it("reads the variant counts and the cap", () => {
    const items = parseProfileItems({
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        { product: { id: "a" }, variants: { pageInfo: { hasNextPage: false }, nodes: [{ id: "v1" }, { id: "v2" }] } },
        { product: { id: "b" }, variants: { pageInfo: { hasNextPage: true }, nodes: [{ id: "v3" }] } },
        { product: { id: "c" } },
        { product: null },
      ],
    });
    expect(items).toEqual([
      { productId: "a", variants: 2, capped: false },
      { productId: "b", variants: 1, capped: true },
      { productId: "c", variants: 0, capped: false },
    ]);
  });
});
