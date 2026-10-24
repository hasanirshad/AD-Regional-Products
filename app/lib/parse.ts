// Turns raw Admin API answers into the plain shapes in types.ts.
// Pure functions: no network, easy to test.

import { isHiddenMarket } from "./hidden";
import type {
  GeneralProfile,
  ProductRow,
  LocationGroup,
  Market,
  Method,
  Operator,
  ProfileSummary,
  RateCondition,
  Zone,
  ZoneCountry,
} from "./types";

// ---- Markets -----------------------------------------------------------

export type RawMarkets = {
  markets: {
    nodes: {
      id: string;
      name: string;
      status: string;
      handle?: string;
      catalogs: { nodes: { id: string; title: string; publication?: { id: string } | null }[] };
      conditions: {
        regionsCondition: {
          regions: {
            nodes: { __typename: string; code?: string; name?: string }[];
          };
        } | null;
      } | null;
    }[];
  };
};

/** Catalogue ids of hidden markets, so products' catalogue lists can ignore them. */
export function hiddenCatalogIds(raw: RawMarkets): string[] {
  return raw.markets.nodes.filter(isHiddenMarket).flatMap((m) => (m.catalogs?.nodes ?? []).map((c) => c.id));
}

export function parseMarkets(raw: RawMarkets): Market[] {
  return raw.markets.nodes.filter((m) => !isHiddenMarket(m)).map((m) => ({
    id: m.id,
    name: m.name,
    status: m.status,
    countries: (m.conditions?.regionsCondition?.regions.nodes ?? [])
      .filter((r) => r.__typename === "MarketRegionCountry" && r.code)
      .map((r) => ({ code: String(r.code).toUpperCase(), name: r.name ?? String(r.code) })),
    catalogs: (m.catalogs?.nodes ?? []).map((c) => ({ id: c.id, title: c.title, publicationId: c.publication?.id ?? null })),
  }));
}

// ---- Profile list ------------------------------------------------------

export type RawProfileSummary = {
  id: string;
  name: string;
  default: boolean;
  activeMethodDefinitionsCount?: number;
  productVariantsCount: { count: number } | null;
  profileLocationGroups: {
    locationGroup: { id: string };
    locationGroupZones: {
      pageInfo?: { hasNextPage: boolean };
      nodes: {
        zone: {
          id: string;
          countries?: { code: { countryCode: string | null; restOfWorld: boolean } }[];
        };
      }[];
    };
  }[];
};

export function parseProfileSummary(raw: RawProfileSummary): ProfileSummary {
  const zones = raw.profileLocationGroups.flatMap((g) => g.locationGroupZones.nodes);
  const countries = new Set<string>();
  let restOfWorld = false;
  for (const n of zones) {
    for (const c of n.zone.countries ?? []) {
      if (c.code.restOfWorld) restOfWorld = true;
      else if (c.code.countryCode) countries.add(c.code.countryCode.toUpperCase());
    }
  }
  return {
    id: raw.id,
    name: raw.name,
    isDefault: raw.default,
    variantCount: raw.productVariantsCount?.count ?? 0,
    locationGroupIds: raw.profileLocationGroups.map((g) => g.locationGroup.id),
    zoneIds: zones.map((n) => n.zone.id),
    countries: [...countries],
    restOfWorld,
    rateCount: raw.activeMethodDefinitionsCount ?? 0,
    zonesTruncated: raw.profileLocationGroups.some((g) => g.locationGroupZones.pageInfo?.hasNextPage === true),
  };
}

// ---- General profile (full) -------------------------------------------

type RawCondition = {
  field: string;
  operator: string;
  conditionCriteria:
    | { __typename: "MoneyV2"; amount: string; currencyCode: string }
    | { __typename: "Weight"; value: number; unit: string }
    | { __typename: string };
};

export type RawGeneral = {
  id: string;
  name: string;
  profileLocationGroups: {
    locationGroup: { id: string; locations: { nodes: { id: string; name: string }[] } };
    locationGroupZones: {
      nodes: {
        zone: {
          id: string;
          name: string;
          countries: {
            code: { countryCode: string | null; restOfWorld: boolean };
            provinces: { code: string }[];
          }[];
        };
        methodDefinitions: {
          nodes: {
            name: string;
            active: boolean;
            description: string | null;
            rateProvider:
              | { __typename: "DeliveryRateDefinition"; price: { amount: string; currencyCode: string } }
              | { __typename: string };
            methodConditions: RawCondition[];
          }[];
        };
      }[];
    };
  }[];
};

const OPERATORS: Operator[] = ["GREATER_THAN_OR_EQUAL_TO", "LESS_THAN_OR_EQUAL_TO"];

function parseCondition(c: RawCondition): RateCondition | string {
  const operator = OPERATORS.find((o) => o === c.operator);
  if (!operator) return `Unknown condition operator ${c.operator}`;
  const crit = c.conditionCriteria as Record<string, unknown>;
  if (c.field === "TOTAL_WEIGHT" && crit.__typename === "Weight") {
    return { kind: "weight", operator, value: Number(crit.value), unit: String(crit.unit) };
  }
  if (c.field === "TOTAL_PRICE" && crit.__typename === "MoneyV2") {
    return { kind: "price", operator, amount: String(crit.amount), currencyCode: String(crit.currencyCode) };
  }
  return `Unknown condition ${c.field}`;
}

function parseMethod(m: RawGeneral["profileLocationGroups"][number]["locationGroupZones"]["nodes"][number]["methodDefinitions"]["nodes"][number]): Method {
  const conditions: RateCondition[] = [];
  let unsupported: string | null = null;
  for (const c of m.methodConditions) {
    const parsed = parseCondition(c);
    if (typeof parsed === "string") unsupported = parsed;
    else conditions.push(parsed);
  }
  const provider = m.rateProvider as { __typename: string; price?: { amount: string; currencyCode: string } };
  const kind: Method["kind"] =
    provider.__typename === "DeliveryRateDefinition" && provider.price
      ? "rate"
      : provider.__typename === "DeliveryParticipant"
        ? "carrier"
        : "unknown";
  return {
    name: m.name,
    description: m.description,
    active: m.active,
    kind,
    price: kind === "rate" && provider.price ? { ...provider.price } : null,
    conditions,
    unsupported,
  };
}

export function parseGeneral(raw: RawGeneral): GeneralProfile {
  const locationGroups: LocationGroup[] = raw.profileLocationGroups.map((lg) => ({
    id: lg.locationGroup.id,
    locations: lg.locationGroup.locations.nodes.map((l) => ({ id: l.id, name: l.name })),
    zones: lg.locationGroupZones.nodes.map((n): Zone => ({
      id: n.zone.id,
      name: n.zone.name,
      countries: n.zone.countries.map((c): ZoneCountry => ({
        code: c.code.countryCode ? c.code.countryCode.toUpperCase() : null,
        restOfWorld: c.code.restOfWorld,
        provinces: c.provinces.map((p) => p.code),
      })),
      methods: n.methodDefinitions.nodes.map(parseMethod),
    })),
  }));
  return { id: raw.id, name: raw.name, locationGroups };
}

// ---- Products ----------------------------------------------------------

export type RawProduct = {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  resourcePublicationsV2: {
    nodes: { publication: { id: string; catalog: { id: string; title: string } | null } }[];
  };
};

export function parseProduct(raw: RawProduct): ProductRow {
  const catalogs = new Map<string, string>();
  for (const n of raw.resourcePublicationsV2.nodes) {
    const c = n.publication.catalog;
    if (c) catalogs.set(c.id, c.title);
  }
  return {
    id: raw.id,
    numericId: raw.id.split("/").pop() ?? raw.id,
    title: raw.title,
    handle: raw.handle,
    vendor: raw.vendor,
    productType: raw.productType,
    status: raw.status,
    tags: raw.tags,
    catalogs: [...catalogs.entries()].map(([id, title]) => ({ id, title })),
  };
}
