import { describe, expect, it } from "vitest";
import { classifyMarkets, planProfile, toProfileInput, toProfileUpdateInput } from "./plan";
import type { GeneralProfile, Market, Method, Zone } from "./types";

const nameOf = (c: string) => c;

const flat = (name: string, amount: string, extra: Partial<Method> = {}): Method => ({
  name,
  description: null,
  active: true,
  kind: "rate",
  price: { amount, currencyCode: "EUR" },
  conditions: [],
  unsupported: null,
  ...extra,
});

const carrier = (name: string): Method => ({
  name,
  description: null,
  active: true,
  kind: "carrier",
  price: null,
  conditions: [],
  unsupported: null,
});

const zone = (id: string, name: string, codes: string[], methods: Method[], rest = false): Zone => ({
  id,
  name,
  countries: [
    ...codes.map((code) => ({ code, restOfWorld: false, provinces: [] as string[] })),
    ...(rest ? [{ code: null, restOfWorld: true, provinces: [] as string[] }] : []),
  ],
  methods,
});

// Shaped like Hardman's General: UK zone, an EU zone (with BE), rest of world.
const general = (): GeneralProfile => ({
  id: "gid://shopify/DeliveryProfile/1",
  name: "General",
  locationGroups: [
    {
      id: "gid://shopify/DeliveryLocationGroup/1",
      locations: [{ id: "gid://shopify/Location/1", name: "London" }],
      zones: [
        zone("z1", "United Kingdom", ["GB"], [
          flat("Standard", "15.00", {
            conditions: [{ kind: "weight", operator: "LESS_THAN_OR_EQUAL_TO", value: 30, unit: "KILOGRAMS" }],
          }),
        ]),
        zone("z2", "Europe", ["DE", "AT", "CH", "NL", "FR", "BE"], [
          flat("Standard", "35.00"),
          carrier("DHL Express"),
        ]),
        zone("z3", "Rest of world", [], [flat("International", "80.00")], true),
      ],
    },
  ],
});

describe("planProfile", () => {
  it("UK only: keeps just the UK zone with its rate and condition", () => {
    const plan = planProfile(general(), ["GB"], nameOf);
    expect(plan.warnings).toEqual([]);
    expect(plan.covered).toEqual(["GB"]);
    const [lg] = plan.locationGroups;
    expect(lg?.zones.map((z) => z.name)).toEqual(["United Kingdom"]);
    expect(lg?.zones[0]?.methods[0]?.conditions).toHaveLength(1);
    expect(lg?.locationIds).toEqual(["gid://shopify/Location/1"]);
  });

  it("Froede: narrows the Europe zone to the five allowed countries (no BE)", () => {
    const plan = planProfile(general(), ["DE", "CH", "FR", "AT", "NL"], nameOf);
    const z = plan.locationGroups[0]?.zones[0];
    expect(z?.name).toBe("Europe");
    expect(z?.countries.map((c) => c.code).sort()).toEqual(["AT", "CH", "DE", "FR", "NL"]);
    expect(plan.uncovered).toEqual([]);
  });

  it("lists carrier-calculated rates as skipped, not copied", () => {
    const plan = planProfile(general(), ["DE"], nameOf);
    const z = plan.locationGroups[0]?.zones[0];
    expect(z?.methods.map((m) => m.name)).toEqual(["Standard"]);
    expect(z?.skipped).toEqual([
      { name: "DHL Express", reason: "Carrier-calculated rate. Add it by hand in Shipping settings." },
    ]);
  });

  it("rest of world becomes the allowed countries no other zone names", () => {
    const plan = planProfile(general(), ["US", "GB"], nameOf);
    const names = plan.locationGroups[0]?.zones.map((z) => z.name);
    expect(names).toEqual(["United Kingdom", "Rest of world"]);
    const row = plan.locationGroups[0]?.zones[1];
    expect(row?.countries.map((c) => c.code)).toEqual(["US"]);
  });

  it("rest of world never takes a country that has its own zone", () => {
    const plan = planProfile(general(), ["GB", "DE"], nameOf);
    const row = plan.locationGroups[0]?.zones.find((z) => z.name === "Rest of world");
    expect(row).toBeUndefined();
  });

  it("warns when a zone has only carrier rates", () => {
    const g = general();
    g.locationGroups[0]!.zones[1]!.methods = [carrier("DHL Express")];
    const plan = planProfile(g, ["DE"], nameOf);
    expect(plan.locationGroups).toEqual([]);
    expect(plan.warnings.join(" ")).toMatch(/no rate that can be copied/);
    expect(plan.uncovered).toEqual(["DE"]);
  });

  it("warns about allowed countries General does not cover (no rest of world zone)", () => {
    const g = general();
    g.locationGroups[0]!.zones = g.locationGroups[0]!.zones.filter((z) => z.id !== "z3");
    const plan = planProfile(g, ["GB", "US"], nameOf);
    expect(plan.uncovered).toEqual(["US"]);
    expect(plan.warnings.join(" ")).toMatch(/US/);
  });

  it("keeps General's province selection for a country", () => {
    const g = general();
    g.locationGroups[0]!.zones[0]!.countries[0]!.provinces = ["ENG", "SCT", "WLS"];
    const plan = planProfile(g, ["GB"], nameOf);
    expect(plan.locationGroups[0]?.zones[0]?.countries[0]?.provinces).toEqual(["ENG", "SCT", "WLS"]);
  });

  it("is case-insensitive and ignores duplicate countries", () => {
    const plan = planProfile(general(), ["gb", "GB"], nameOf);
    expect(plan.covered).toEqual(["GB"]);
  });
});

describe("toProfileInput", () => {
  it("builds the create input with conditions and province choices", () => {
    const g = general();
    g.locationGroups[0]!.zones[0]!.countries[0]!.provinces = ["ENG"];
    const input = toProfileInput("Group: UK", planProfile(g, ["GB", "DE"], nameOf));
    expect(input.name).toBe("Group: UK");
    const [lg] = input.locationGroupsToCreate;
    expect(lg?.locationsToAdd).toEqual(["gid://shopify/Location/1"]);
    const uk = lg?.zonesToCreate[0];
    expect(uk?.countries).toEqual([{ code: "GB", provinces: [{ code: "ENG" }] }]);
    expect(uk?.methodDefinitionsToCreate[0]).toMatchObject({
      name: "Standard",
      active: true,
      rateDefinition: { price: { amount: "15.00", currencyCode: "EUR" } },
      weightConditionsToCreate: [
        { operator: "LESS_THAN_OR_EQUAL_TO", criteria: { value: 30, unit: "KILOGRAMS" } },
      ],
    });
    const eu = lg?.zonesToCreate[1];
    expect(eu?.countries).toEqual([{ code: "DE", includeAllProvinces: true }]);
    expect(eu?.methodDefinitionsToCreate).toHaveLength(1); // carrier rate left out
  });

  it("writes price conditions", () => {
    const g = general();
    g.locationGroups[0]!.zones[0]!.methods = [
      flat("Free over 500", "0.00", {
        conditions: [{ kind: "price", operator: "GREATER_THAN_OR_EQUAL_TO", amount: "500.0", currencyCode: "EUR" }],
      }),
    ];
    const input = toProfileInput("Group: UK", planProfile(g, ["GB"], nameOf));
    expect(input.locationGroupsToCreate[0]?.zonesToCreate[0]?.methodDefinitionsToCreate[0]).toMatchObject({
      priceConditionsToCreate: [
        { operator: "GREATER_THAN_OR_EQUAL_TO", criteria: { amount: "500.0", currencyCode: "EUR" } },
      ],
    });
  });
});

describe("toProfileUpdateInput", () => {
  const plan = () => planProfile(general(), ["GB"], nameOf);

  it("deletes old zones and creates new ones in the existing location group", () => {
    const input = toProfileUpdateInput("Group: UK", plan(), {
      locationGroupIds: ["lg1"],
      zoneIds: ["zOld1", "zOld2"],
    });
    expect(input.zonesToDelete).toEqual(["zOld1", "zOld2"]);
    expect(input.locationGroupsToUpdate[0]?.id).toBe("lg1");
    expect(input.locationGroupsToUpdate[0]?.zonesToCreate[0]?.name).toBe("United Kingdom");
  });

  it("refuses profiles with more than one location group", () => {
    expect(() =>
      toProfileUpdateInput("x", plan(), { locationGroupIds: ["a", "b"], zoneIds: [] }),
    ).toThrow(/single shipping origin/);
  });
});

describe("classifyMarkets", () => {
  const market = (name: string, codes: string[], status = "ACTIVE"): Market => ({
    id: name,
    name,
    status,
    countries: codes.map((code) => ({ code, name: code })),
    catalogs: [],
  });

  it("classifies all, none and mixed, and skips inactive markets", () => {
    const result = classifyMarkets(
      ["GB", "DE"],
      [
        market("UK", ["GB"]),
        market("US", ["US"]),
        market("DACH", ["DE", "AT"]),
        market("Draft", ["FR"], "DRAFT"),
      ],
    );
    expect(result.map((r) => [r.market.name, r.state])).toEqual([
      ["UK", "all"],
      ["US", "none"],
      ["DACH", "mixed"],
    ]);
    expect(result[2]?.blocked.map((c) => c.code)).toEqual(["AT"]);
  });
});
