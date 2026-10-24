// The planning logic. Pure functions, no network.
//
// Given the General shipping profile and a group's allowed countries, work out
// what the group's shipping profile should contain: General's zones narrowed to
// the allowed countries, with General's flat rates copied across.
//
// Rules (agreed with Hasan):
//  - Carrier-calculated rates are NOT copied. They are listed as skipped.
//  - "Rest of world" in General becomes the allowed countries no other zone has.
//  - Nothing is guessed: anything that cannot be copied shows up as a warning.

import { countryName } from "./countries";
import type {
  GeneralProfile,
  Market,
  MarketResult,
  Method,
  PlannedLocationGroup,
  PlannedZone,
  ProfilePlan,
  RateCondition,
  ZoneCountry,
} from "./types";

export function planProfile(
  general: GeneralProfile,
  allowedCodes: string[],
  nameOf: (code: string) => string = countryName,
): ProfilePlan {
  const allowed = [...new Set(allowedCodes.map((c) => c.toUpperCase()))];
  const allowedSet = new Set(allowed);
  const covered = new Set<string>();
  const warnings: string[] = [];
  const locationGroups: PlannedLocationGroup[] = [];

  for (const lg of general.locationGroups) {
    // Countries General names explicitly in some zone (so "rest of world" excludes them).
    const explicit = new Set<string>();
    for (const z of lg.zones) for (const c of z.countries) if (c.code) explicit.add(c.code);

    const zones: PlannedZone[] = [];
    for (const z of lg.zones) {
      const countries: ZoneCountry[] = [];
      for (const c of z.countries) {
        if (c.code && allowedSet.has(c.code)) {
          countries.push({ code: c.code, restOfWorld: false, provinces: [...c.provinces] });
        }
      }
      if (z.countries.some((c) => c.restOfWorld)) {
        for (const code of allowed) {
          if (!explicit.has(code)) countries.push({ code, restOfWorld: false, provinces: [] });
        }
      }
      if (countries.length === 0) continue;

      const methods: Method[] = [];
      const skipped: PlannedZone["skipped"] = [];
      for (const m of z.methods) {
        if (m.kind === "carrier") {
          skipped.push({ name: m.name, reason: "Carrier-calculated rate. Add it by hand in Shipping settings." });
        } else if (m.kind === "unknown") {
          skipped.push({ name: m.name, reason: "Unknown rate type, not copied." });
        } else if (m.unsupported) {
          skipped.push({ name: m.name, reason: `${m.unsupported}, not copied.` });
        } else {
          methods.push(m);
        }
      }

      const codes = countries.map((c) => c.code ?? "").filter(Boolean);
      if (methods.length === 0) {
        warnings.push(
          `Zone "${z.name}" has no rate that can be copied, so ${codes.join(", ")} would have no shipping.`,
        );
        continue;
      }
      for (const code of codes) covered.add(code);
      zones.push({ name: z.name, countries, methods, skipped });
    }

    if (zones.length > 0) {
      locationGroups.push({
        locationIds: lg.locations.map((l) => l.id),
        locationNames: lg.locations.map((l) => l.name),
        zones,
      });
    }
  }

  const uncovered = allowed.filter((c) => !covered.has(c));
  if (uncovered.length > 0) {
    warnings.push(
      `General has no usable shipping rate for ${uncovered.map(nameOf).join(", ")}. ` +
        "Customers there could not check out these products.",
    );
  }

  return { locationGroups, warnings, covered: [...covered], uncovered };
}

// ---- Markets -----------------------------------------------------------

/** For each active market: are all its countries allowed, none, or some? */
export function classifyMarkets(allowedCodes: string[], markets: Market[]): MarketResult[] {
  const allowed = new Set(allowedCodes.map((c) => c.toUpperCase()));
  const results: MarketResult[] = [];
  for (const market of markets) {
    if (market.status !== "ACTIVE" || market.countries.length === 0) continue;
    const ok = market.countries.filter((c) => allowed.has(c.code));
    const blocked = market.countries.filter((c) => !allowed.has(c.code));
    results.push({
      market,
      state: blocked.length === 0 ? "all" : ok.length === 0 ? "none" : "mixed",
      allowed: ok,
      blocked,
    });
  }
  return results;
}

// ---- Admin API input ---------------------------------------------------

function conditionInputs(conditions: RateCondition[]) {
  const weight = conditions.flatMap((c) =>
    c.kind === "weight"
      ? [{ operator: c.operator, criteria: { value: c.value, unit: c.unit } }]
      : [],
  );
  const price = conditions.flatMap((c) =>
    c.kind === "price"
      ? [{ operator: c.operator, criteria: { amount: c.amount, currencyCode: c.currencyCode } }]
      : [],
  );
  return { weight, price };
}

function methodInput(m: Method) {
  const { weight, price } = conditionInputs(m.conditions);
  return {
    name: m.name,
    ...(m.description ? { description: m.description } : {}),
    active: m.active,
    rateDefinition: { price: { amount: m.price?.amount ?? "0", currencyCode: m.price?.currencyCode ?? "" } },
    ...(weight.length ? { weightConditionsToCreate: weight } : {}),
    ...(price.length ? { priceConditionsToCreate: price } : {}),
  };
}

function zoneInput(z: PlannedZone) {
  return {
    name: z.name,
    countries: z.countries.map((c) =>
      c.provinces.length > 0
        ? { code: c.code, provinces: c.provinces.map((code) => ({ code })) }
        : { code: c.code, includeAllProvinces: true },
    ),
    methodDefinitionsToCreate: z.methods.map(methodInput),
  };
}

/** Input for deliveryProfileCreate. */
export function toProfileInput(name: string, plan: ProfilePlan) {
  return {
    name,
    locationGroupsToCreate: plan.locationGroups.map((lg) => ({
      locationsToAdd: lg.locationIds,
      zonesToCreate: lg.zones.map(zoneInput),
    })),
  };
}

/**
 * Input for deliveryProfileUpdate: rename, remove all current zones and create
 * the new ones in the existing location group.
 * Only for profiles with exactly one location group.
 */
export function toProfileUpdateInput(
  name: string,
  plan: ProfilePlan,
  existing: { locationGroupIds: string[]; zoneIds: string[] },
) {
  const [locationGroupId] = existing.locationGroupIds;
  const [planned] = plan.locationGroups;
  if (existing.locationGroupIds.length !== 1 || plan.locationGroups.length !== 1 || !locationGroupId || !planned) {
    throw new Error(
      "Editing is only supported for profiles with a single shipping origin for now. Create a new group instead.",
    );
  }
  return {
    name,
    zonesToDelete: existing.zoneIds,
    locationGroupsToUpdate: [
      { id: locationGroupId, zonesToCreate: planned.zones.map(zoneInput) },
    ],
  };
}
