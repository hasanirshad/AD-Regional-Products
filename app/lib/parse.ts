// Turns raw Admin API answers into the plain shapes in types.ts.
// Pure functions: no network, easy to test.

import { isHiddenMarket } from "./hidden";
import type { Market, ProductRow, ProfileSummary, ProfileZone } from "./types";

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

const toMarket = (m: RawMarkets["markets"]["nodes"][number]): Market => ({
  id: m.id,
  name: m.name,
  status: m.status,
  countries: (m.conditions?.regionsCondition?.regions.nodes ?? [])
    .filter((r) => r.__typename === "MarketRegionCountry" && r.code)
    .map((r) => ({ code: String(r.code).toUpperCase(), name: r.name ?? String(r.code) })),
  catalogs: (m.catalogs?.nodes ?? []).map((c) => ({ id: c.id, title: c.title, publicationId: c.publication?.id ?? null })),
});

export function parseMarkets(raw: RawMarkets): Market[] {
  return raw.markets.nodes.filter((m) => !isHiddenMarket(m)).map(toMarket);
}

/** The hidden markets (Global). Only the Channels page uses them. */
export function parseHiddenMarkets(raw: RawMarkets): Market[] {
  return raw.markets.nodes.filter(isHiddenMarket).map(toMarket);
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

/** What a profile really ships to, from its zones. A zone without active rates ships nowhere. */
export function deriveShipping(zones: ProfileZone[]): Pick<ProfileSummary, "countries" | "restOfWorld" | "unratedCountries"> {
  const countries = new Set<string>();
  const unrated = new Set<string>();
  let restOfWorld = false;
  for (const z of zones) {
    const rated = z.rateCount !== 0; // null (unknown) counts as rated
    for (const c of z.countries) (rated ? countries : unrated).add(c);
    if (z.restOfWorld && rated) restOfWorld = true;
  }
  for (const c of countries) unrated.delete(c); // listed in a rated zone too: it ships
  return { countries: [...countries], restOfWorld, unratedCountries: [...unrated] };
}

export function parseProfileSummary(raw: RawProfileSummary): ProfileSummary {
  const zoneNodes = raw.profileLocationGroups.flatMap((g) => g.locationGroupZones.nodes);
  const zones: ProfileZone[] = raw.profileLocationGroups.flatMap((g) =>
    g.locationGroupZones.nodes.map((n) => ({
      id: n.zone.id,
      name: n.zone.name ?? "Zone",
      locationGroupId: g.locationGroup.id,
      countries: (n.zone.countries ?? [])
        .filter((c) => !c.code.restOfWorld && c.code.countryCode)
        .map((c) => String(c.code.countryCode).toUpperCase()),
      restOfWorld: (n.zone.countries ?? []).some((c) => c.code.restOfWorld),
      rateCount: null,
    })),
  );
  return {
    id: raw.id,
    name: raw.name,
    isDefault: raw.default,
    variantCount: raw.productVariantsCount?.count ?? 0,
    locationGroupIds: raw.profileLocationGroups.map((g) => g.locationGroup.id),
    zoneIds: zoneNodes.map((n) => n.zone.id),
    zones,
    ...deriveShipping(zones),
    ratesKnown: false,
    rateCount: raw.activeMethodDefinitionsCount ?? 0,
    zonesTruncated: raw.profileLocationGroups.some((g) => g.locationGroupZones.pageInfo?.hasNextPage === true),
  };
}

// ---- Zone rates --------------------------------------------------------

export type RawZoneRates = {
  deliveryProfile: {
    profileLocationGroups: {
      locationGroupZones: {
        nodes: { zone: { id: string }; methodDefinitions: { nodes: { active: boolean }[] } }[];
      };
    }[];
  } | null;
};

/** zone id -> number of active rates (of the first ones read). */
export function parseZoneRates(raw: RawZoneRates): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of raw.deliveryProfile?.profileLocationGroups ?? []) {
    for (const n of g.locationGroupZones.nodes) {
      out[n.zone.id] = n.methodDefinitions.nodes.filter((m) => m.active).length;
    }
  }
  return out;
}

/** The profile again, with each zone's rate count filled in and the shipping countries recomputed. */
export function withZoneRates(profile: ProfileSummary, rates: Record<string, number>): ProfileSummary {
  const zones = profile.zones.map((z) => ({ ...z, rateCount: rates[z.id] ?? z.rateCount }));
  return { ...profile, zones, ...deriveShipping(zones), ratesKnown: true };
}

// ---- Profile items (which variants are in a profile) --------------------

export type RawProfileItems = {
  deliveryProfile: {
    profileItems: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        product: { id: string } | null;
        variants?: { pageInfo?: { hasNextPage: boolean }; nodes: { id: string }[] } | null;
      }[];
    };
  } | null;
};

export type ProfileItem = {
  productId: string;
  /** Variants of the product in this profile. 0 = not read. */
  variants: number;
  /** True when the profile holds more variants than were read (more than 250). */
  capped: boolean;
};

export function parseProfileItems(items: NonNullable<RawProfileItems["deliveryProfile"]>["profileItems"]): ProfileItem[] {
  const out: ProfileItem[] = [];
  for (const n of items.nodes) {
    if (!n.product) continue;
    out.push({
      productId: n.product.id,
      variants: n.variants?.nodes.length ?? 0,
      capped: n.variants?.pageInfo?.hasNextPage === true,
    });
  }
  return out;
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
  variantsCount?: { count: number } | null;
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
    variantCount: raw.variantsCount?.count ?? 0,
  };
}
