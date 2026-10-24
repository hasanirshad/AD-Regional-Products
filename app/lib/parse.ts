// Turns raw Admin API answers into the plain shapes in types.ts.
// Pure functions: no network, easy to test.

import { isHiddenMarket } from "./hidden";
import type { Market, ProductRow, ProfileSummary } from "./types";

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
          name?: string;
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
    zones: raw.profileLocationGroups.flatMap((g) =>
      g.locationGroupZones.nodes.map((n) => ({
        id: n.zone.id,
        name: n.zone.name ?? "Zone",
        locationGroupId: g.locationGroup.id,
        countries: (n.zone.countries ?? [])
          .filter((c) => !c.code.restOfWorld && c.code.countryCode)
          .map((c) => String(c.code.countryCode).toUpperCase()),
        restOfWorld: (n.zone.countries ?? []).some((c) => c.code.restOfWorld),
      })),
    ),
    countries: [...countries],
    restOfWorld,
    rateCount: raw.activeMethodDefinitionsCount ?? 0,
    zonesTruncated: raw.profileLocationGroups.some((g) => g.locationGroupZones.pageInfo?.hasNextPage === true),
  };
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
