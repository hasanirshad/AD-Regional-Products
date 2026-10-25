import { describe, expect, it } from "vitest";
import { hiddenCatalogIds, parseHiddenMarkets, parseMarkets, parseProfileSummary } from "./parse";

describe("parseMarkets", () => {
  it("reads countries from region conditions and ignores other region types", () => {
    const markets = parseMarkets({
      markets: {
        nodes: [
          {
            id: "m1",
            name: "DACH",
            status: "ACTIVE",
            catalogs: { nodes: [{ id: "cat1", title: "DACH catalogue", publication: { id: "pub1" } }] },
            conditions: {
              regionsCondition: {
                regions: {
                  nodes: [
                    { __typename: "MarketRegionCountry", code: "de", name: "Germany" },
                    { __typename: "MarketRegionCountry", code: "AT", name: "Austria" },
                    { __typename: "SomethingElse" },
                  ],
                },
              },
            },
          },
          { id: "m2", name: "B2B", status: "ACTIVE", catalogs: { nodes: [] }, conditions: null },
        ],
      },
    });
    expect(markets[0]?.countries).toEqual([
      { code: "DE", name: "Germany" },
      { code: "AT", name: "Austria" },
    ]);
    expect(markets[1]?.countries).toEqual([]);
    expect(markets[0]?.catalogs).toEqual([{ id: "cat1", title: "DACH catalogue", publicationId: "pub1" }]);
  });
});

describe("hidden markets", () => {
  const raw = {
    markets: {
      nodes: [
        { id: "m1", name: "Global", handle: "de", status: "ACTIVE", catalogs: { nodes: [{ id: "cat-g", title: "Global" }] }, conditions: null },
        { id: "m2", name: "Germany", handle: "germany", status: "ACTIVE", catalogs: { nodes: [{ id: "cat-de", title: "Germany" }] }, conditions: null },
        { id: "m3", name: "Global", handle: "other", status: "ACTIVE", catalogs: { nodes: [] }, conditions: null },
      ],
    },
  };
  it("drops only the market whose name AND handle match, and reports its catalogues", () => {
    expect(parseMarkets(raw).map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(hiddenCatalogIds(raw)).toEqual(["cat-g"]);
  });
  it("parseHiddenMarkets returns the hidden market with its catalogue (the Channels page uses it)", () => {
    const hidden = parseHiddenMarkets(raw);
    expect(hidden.map((m) => m.id)).toEqual(["m1"]);
    expect(hidden[0]?.catalogs).toEqual([{ id: "cat-g", title: "Global", publicationId: null }]);
  });
});

describe("parseProfileSummary", () => {
  it("collects location group ids, zone ids and the variant count", () => {
    const s = parseProfileSummary({
      id: "p1",
      name: "Group: UK",
      default: false,
      activeMethodDefinitionsCount: 3,
      productVariantsCount: { count: 12 },
      profileLocationGroups: [
        {
          locationGroup: { id: "lg1" },
          locationGroupZones: {
            pageInfo: { hasNextPage: false },
            nodes: [
              { zone: { id: "z1", countries: [{ code: { countryCode: "gb", restOfWorld: false } }] } },
              { zone: { id: "z2", countries: [{ code: { countryCode: null, restOfWorld: true } }] } },
            ],
          },
        },
      ],
    });
    expect(s).toEqual({
      id: "p1",
      name: "Group: UK",
      isDefault: false,
      variantCount: 12,
      locationGroupIds: ["lg1"],
      zoneIds: ["z1", "z2"],
      zones: [
        { id: "z1", name: "Zone", locationGroupId: "lg1", countries: ["GB"], restOfWorld: false, rateCount: null },
        { id: "z2", name: "Zone", locationGroupId: "lg1", countries: [], restOfWorld: true, rateCount: null },
      ],
      countries: ["GB"],
      restOfWorld: true,
      unratedCountries: [],
      ratesKnown: false,
      rateCount: 3,
      zonesTruncated: false,
    });
  });
  it("treats a missing count as zero", () => {
    expect(
      parseProfileSummary({ id: "p", name: "n", default: true, productVariantsCount: null, profileLocationGroups: [] })
        .variantCount,
    ).toBe(0);
  });
});
