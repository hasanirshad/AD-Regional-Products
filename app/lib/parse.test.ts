import { describe, expect, it } from "vitest";
import { parseGeneral, parseMarkets, parseProfileSummary, type RawGeneral } from "./parse";

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
      countries: ["GB"],
      restOfWorld: true,
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

const raw = (): RawGeneral => ({
  id: "gid://shopify/DeliveryProfile/1",
  name: "General",
  profileLocationGroups: [
    {
      locationGroup: { id: "lg1", locations: { nodes: [{ id: "loc1", name: "London" }] } },
      locationGroupZones: {
        nodes: [
          {
            zone: {
              id: "z1",
              name: "UK",
              countries: [{ code: { countryCode: "GB", restOfWorld: false }, provinces: [{ code: "ENG" }] }],
            },
            methodDefinitions: {
              nodes: [
                {
                  name: "Standard",
                  active: true,
                  description: null,
                  rateProvider: { __typename: "DeliveryRateDefinition", price: { amount: "15.0", currencyCode: "EUR" } },
                  methodConditions: [
                    {
                      field: "TOTAL_WEIGHT",
                      operator: "LESS_THAN_OR_EQUAL_TO",
                      conditionCriteria: { __typename: "Weight", value: 30, unit: "KILOGRAMS" },
                    },
                  ],
                },
                {
                  name: "Courier",
                  active: true,
                  description: null,
                  rateProvider: { __typename: "DeliveryParticipant" },
                  methodConditions: [],
                },
                {
                  name: "Odd",
                  active: true,
                  description: null,
                  rateProvider: { __typename: "DeliveryRateDefinition", price: { amount: "1.0", currencyCode: "EUR" } },
                  methodConditions: [
                    {
                      field: "SOMETHING_NEW",
                      operator: "LESS_THAN_OR_EQUAL_TO",
                      conditionCriteria: { __typename: "Weight", value: 1, unit: "KILOGRAMS" },
                    },
                  ],
                },
              ],
            },
          },
          {
            zone: {
              id: "z2",
              name: "Rest of world",
              countries: [{ code: { countryCode: null, restOfWorld: true }, provinces: [] }],
            },
            methodDefinitions: { nodes: [] },
          },
        ],
      },
    },
  ],
});

describe("parseGeneral", () => {
  it("maps zones, countries, provinces and location names", () => {
    const g = parseGeneral(raw());
    expect(g.locationGroups[0]?.locations).toEqual([{ id: "loc1", name: "London" }]);
    expect(g.locationGroups[0]?.zones[0]?.countries).toEqual([
      { code: "GB", restOfWorld: false, provinces: ["ENG"] },
    ]);
    expect(g.locationGroups[0]?.zones[1]?.countries).toEqual([{ code: null, restOfWorld: true, provinces: [] }]);
  });

  it("recognises flat rates with conditions, carrier rates and unknown conditions", () => {
    const methods = parseGeneral(raw()).locationGroups[0]?.zones[0]?.methods ?? [];
    expect(methods[0]).toMatchObject({
      kind: "rate",
      price: { amount: "15.0", currencyCode: "EUR" },
      conditions: [{ kind: "weight", operator: "LESS_THAN_OR_EQUAL_TO", value: 30, unit: "KILOGRAMS" }],
      unsupported: null,
    });
    expect(methods[1]).toMatchObject({ kind: "carrier", price: null });
    expect(methods[2]?.unsupported).toMatch(/SOMETHING_NEW/);
  });
});
