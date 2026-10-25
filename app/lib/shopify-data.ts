// Reads from Shopify (writes are in applyMove.ts). Raw answers go through parse.ts.
// Reads work on the Hardman store. The newer reads (zone rates, variants per
// profile item) are still unverified, so they are tolerant: when one fails the
// app falls back to the simpler answer and says so. Shopify refuses any query
// whose REQUESTED cost is over 1,000, so keep `first` x nested `first` small.

import { adminGraphql } from "./admin";
import {
  hiddenCatalogIds,
  parseHiddenMarkets,
  parseMarkets,
  parseProduct,
  parseProfileItems,
  parseProfileSummary,
  parseZoneRates,
  withZoneRates,
  type ProfileItem,
  type RawMarkets,
  type RawProduct,
  type RawProfileItems,
  type RawProfileSummary,
  type RawZoneRates,
} from "./parse";
import type { Channel } from "./channels";
import type { ProductDetail } from "./check";
import type { Theme, WebPresence } from "./links";
import { profileKeyOf } from "./readback";
import type { Market, ProductRow, ProfileSummary } from "./types";

const SHOP = `#graphql
  query Shop { shop { name myshopifyDomain } }`;

const MARKETS = `#graphql
  query Markets {
    markets(first: 100) {
      nodes {
        id
        name
        handle
        status
        catalogs(first: 10) { nodes { id title publication { id } } }
        conditions {
          regionsCondition {
            regions(first: 250) {
              nodes {
                __typename
                ... on MarketRegionCountry { code name }
              }
            }
          }
        }
      }
    }
  }`;

const PROFILES = `#graphql
  query Profiles($after: String) {
    deliveryProfiles(first: 5, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        default
        activeMethodDefinitionsCount
        productVariantsCount { count }
        profileLocationGroups {
          locationGroup { id }
          locationGroupZones(first: 30) {
            pageInfo { hasNextPage }
            nodes {
              zone {
                id
                name
                countries { code { countryCode restOfWorld } }
              }
            }
          }
        }
      }
    }
  }`;

export async function loadShop(): Promise<{ name: string; domain: string }> {
  const data = await adminGraphql<{ shop: { name: string; myshopifyDomain: string } }>(SHOP);
  return { name: data.shop.name, domain: data.shop.myshopifyDomain };
}

export async function loadMarkets(): Promise<{ markets: Market[]; hiddenMarkets: Market[]; hiddenCatalogIds: string[] }> {
  const raw = await adminGraphql<RawMarkets>(MARKETS);
  return { markets: parseMarkets(raw), hiddenMarkets: parseHiddenMarkets(raw), hiddenCatalogIds: hiddenCatalogIds(raw) };
}

/** Every shipping profile in the store, as light summaries. */
export async function loadProfiles(): Promise<ProfileSummary[]> {
  const out: ProfileSummary[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const data: {
      deliveryProfiles: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: RawProfileSummary[];
      };
    } = await adminGraphql(PROFILES, { after });
    out.push(...data.deliveryProfiles.nodes.map(parseProfileSummary));
    if (!data.deliveryProfiles.pageInfo.hasNextPage) break;
    after = data.deliveryProfiles.pageInfo.endCursor;
  }
  // Which zones have rates. A zone without rates ships nowhere. Read per profile
  // and tolerate a failure: that profile then keeps "rates unknown".
  return Promise.all(out.map(loadZoneRates));
}

const ZONE_RATES = `#graphql
  query ZoneRates($id: ID!) {
    deliveryProfile(id: $id) {
      profileLocationGroups {
        locationGroupZones(first: 30) {
          nodes {
            zone { id }
            methodDefinitions(first: 10) { nodes { active } }
          }
        }
      }
    }
  }`;

async function loadZoneRates(profile: ProfileSummary): Promise<ProfileSummary> {
  if (profile.zones.length === 0) return { ...profile, ratesKnown: true };
  try {
    const raw = await adminGraphql<RawZoneRates>(ZONE_RATES, { id: profile.id });
    return withZoneRates(profile, parseZoneRates(raw));
  } catch {
    return profile;
  }
}

const PROFILE_ONE = `#graphql
  query ProfileOne($id: ID!) {
    deliveryProfile(id: $id) {
      id
      name
      default
      activeMethodDefinitionsCount
      productVariantsCount { count }
      profileLocationGroups {
        locationGroup { id }
        locationGroupZones(first: 30) {
          pageInfo { hasNextPage }
          nodes {
            zone {
              id
              name
              countries { code { countryCode restOfWorld } }
            }
          }
        }
      }
    }
  }`;

/** One profile, read fresh (with zone rates). Used to recheck and verify a zone edit. */
export async function loadProfileFresh(id: string): Promise<ProfileSummary | null> {
  const data = await adminGraphql<{ deliveryProfile: RawProfileSummary | null }>(PROFILE_ONE, { id });
  if (!data.deliveryProfile) return null;
  return loadZoneRates(parseProfileSummary(data.deliveryProfile));
}

/** The General (default) profile in full: zones, rates, conditions. */
// ---- Products ----------------------------------------------------------

// 25 per page with up to 10 catalogues each keeps one request well under
// Shopify's per-query cost limit.
const PRODUCTS = `#graphql
  query Products($after: String, $query: String) {
    products(first: 25, after: $after, sortKey: TITLE, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        vendor
        productType
        status
        tags
        variantsCount { count }
        resourcePublicationsV2(first: 10, onlyPublished: true, catalogType: MARKET) {
          nodes {
            publication {
              id
              catalog { id title }
            }
          }
        }
      }
    }
  }`;

// Three items with up to 250 variants each stay under the 1,000 cost limit.
const PROFILE_ITEMS = `#graphql
  query ProfileItems($id: ID!, $after: String) {
    deliveryProfile(id: $id) {
      profileItems(first: 3, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          product { id }
          variants(first: 250) { pageInfo { hasNextPage } nodes { id } }
        }
      }
    }
  }`;

// The simpler read (no variants), used when the one above is refused.
const PROFILE_ITEMS_LITE = `#graphql
  query ProfileItemsLite($id: ID!, $after: String) {
    deliveryProfile(id: $id) {
      profileItems(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { product { id } }
      }
    }
  }`;

/** Shopify search text for each scope. Active only is the quick first load. */
export const PRODUCT_QUERY = { active: "status:active", all: null } as const;

export async function loadProductsPage(
  after: string | null,
  query: string | null = null,
): Promise<{ rows: ProductRow[]; hasNext: boolean; cursor: string | null }> {
  const data = await adminGraphql<{
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawProduct[];
    };
  }>(PRODUCTS, { after, query });
  return {
    rows: data.products.nodes.map(parseProduct),
    hasNext: data.products.pageInfo.hasNextPage,
    cursor: data.products.pageInfo.endCursor,
  };
}

export type ProfileContents = {
  /** product id -> where it sits, one entry per non-default profile that holds some of its variants. */
  items: Record<string, { key: string; variants: number; capped: boolean }[]>;
  /** False when variants could not be read, so split products cannot be detected. */
  variantsKnown: boolean;
  /** True when a profile had more items than were read. */
  truncated: boolean;
};

const MAX_ITEM_PAGES = 4000;

async function readProfileItems(profile: ProfileSummary, lite: boolean): Promise<{ items: ProfileItem[]; truncated: boolean }> {
  const items: ProfileItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_ITEM_PAGES; page++) {
    const data: RawProfileItems = await adminGraphql(lite ? PROFILE_ITEMS_LITE : PROFILE_ITEMS, { id: profile.id, after });
    const found = data.deliveryProfile?.profileItems;
    if (!found) return { items, truncated: false };
    items.push(...parseProfileItems(found));
    if (!found.pageInfo.hasNextPage) return { items, truncated: false };
    after = found.pageInfo.endCursor;
  }
  return { items, truncated: true };
}

/** What each shipping profile besides General holds. General is the default and is left out. */
export async function loadMembership(profiles: ProfileSummary[]): Promise<ProfileContents> {
  const contents: ProfileContents = { items: {}, variantsKnown: true, truncated: false };
  for (const profile of profiles) {
    if (profile.isDefault || profile.variantCount === 0) continue;
    let read: { items: ProfileItem[]; truncated: boolean };
    try {
      read = await readProfileItems(profile, false);
    } catch {
      // The variants part was refused: read the products only.
      read = await readProfileItems(profile, true);
      contents.variantsKnown = false;
    }
    if (read.truncated) contents.truncated = true;
    for (const it of read.items) {
      const list = (contents.items[it.productId] ??= []);
      const same = list.find((e) => e.key === profile.id);
      if (same) {
        same.variants += it.variants;
        same.capped ||= it.capped;
      } else list.push({ key: profile.id, variants: it.variants, capped: it.capped });
    }
  }
  return contents;
}

// ---- One product, read fresh (Product check) -------------------------------

const PRODUCT_DETAIL = `#graphql
  query ProductDetail($id: ID!) {
    product(id: $id) {
      id
      title
      status
      variantsCount { count }
      variants(first: 250) {
        pageInfo { hasNextPage }
        nodes { id title sku deliveryProfile { id default } }
      }
      resourcePublicationsV2(first: 10, onlyPublished: true, catalogType: MARKET) {
        nodes { publication { catalog { id title } } }
      }
    }
  }`;

type RawProductDetail = {
  id: string;
  title: string;
  status: string;
  variantsCount?: { count: number } | null;
  variants: {
    pageInfo: { hasNextPage: boolean };
    nodes: { id: string; title: string; sku: string | null; deliveryProfile: { id: string; default: boolean } | null }[];
  };
  resourcePublicationsV2?: { nodes: { publication?: { catalog?: { id: string; title: string } | null } | null }[] };
};

/** One product with its variants' shipping profiles and market catalogues. Free to call; nothing is written. */
export async function loadProductDetail(id: string, hiddenCatalogIds: string[] = []): Promise<ProductDetail | null> {
  const data = await adminGraphql<{ product: RawProductDetail | null }>(PRODUCT_DETAIL, { id });
  const p = data.product;
  if (!p) return null;
  const hidden = new Set(hiddenCatalogIds);
  const catalogs = new Map<string, string>();
  for (const n of p.resourcePublicationsV2?.nodes ?? []) {
    const c = n.publication?.catalog;
    if (c && !hidden.has(c.id)) catalogs.set(c.id, c.title);
  }
  return {
    id: p.id,
    numericId: p.id.split("/").pop() ?? p.id,
    title: p.title,
    status: p.status,
    catalogs: [...catalogs.entries()].map(([cid, title]) => ({ id: cid, title })),
    variants: p.variants.nodes.map((v) => ({ id: v.id, title: v.title, sku: v.sku ?? "", profileKey: profileKeyOf(v.deliveryProfile) })),
    variantsComplete: !p.variants.pageInfo.hasNextPage,
    variantTotal: p.variantsCount?.count ?? p.variants.nodes.length,
  };
}

// ---- Sales channels -------------------------------------------------------------

const CHANNELS = `#graphql
  query Channels {
    publications(first: 50) { nodes { id name catalog { id } app { title } } }
  }`;

// If this API version has no `name` on a publication, the app title is used.
const CHANNELS_LITE = `#graphql
  query ChannelsLite {
    publications(first: 50) { nodes { id catalog { id } app { title } } }
  }`;

type RawChannels = { publications: { nodes: { id: string; name?: string | null; catalog: { id: string } | null; app?: { title: string } | null }[] } };

/** Sales channels: publications that do not belong to a catalogue. Free to call. */
export async function loadChannels(): Promise<Channel[]> {
  let raw: RawChannels;
  try {
    raw = await adminGraphql<RawChannels>(CHANNELS);
  } catch {
    raw = await adminGraphql<RawChannels>(CHANNELS_LITE);
  }
  return raw.publications.nodes
    .filter((p) => !p.catalog)
    .map((p) => ({ id: p.id, name: p.app?.title || p.name || "Sales channel" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Storefront addresses and themes (Storefront links page) -----------------

const MARKET_ROOTS = `#graphql
  query MarketRoots {
    shop { primaryDomain { url } }
    markets(first: 100) {
      nodes {
        id
        webPresences(first: 10) {
          nodes {
            domain { host }
            subfolderSuffix
            rootUrls { locale url }
          }
        }
      }
    }
  }`;

// Fallback if rootUrls cannot be read: the domain host and the subfolder are enough to build the address.
const MARKET_ROOTS_LITE = `#graphql
  query MarketRootsLite {
    shop { primaryDomain { url } }
    markets(first: 100) {
      nodes {
        id
        webPresences(first: 10) { nodes { domain { host } subfolderSuffix } }
      }
    }
  }`;

type RawMarketRoots = {
  shop: { primaryDomain: { url: string } | null };
  markets: {
    nodes: {
      id: string;
      webPresences?: {
        nodes: {
          domain?: { host: string } | null;
          subfolderSuffix?: string | null;
          rootUrls?: { locale: string; url: string }[] | null;
        }[];
      } | null;
    }[];
  };
};

/** The store's primary domain and, per market, its web presences (domain / subfolder). Free to call. */
export async function loadMarketRoots(): Promise<{ primaryUrl: string; presences: Record<string, WebPresence[]> }> {
  let raw: RawMarketRoots;
  try {
    raw = await adminGraphql<RawMarketRoots>(MARKET_ROOTS);
  } catch {
    raw = await adminGraphql<RawMarketRoots>(MARKET_ROOTS_LITE);
  }
  const presences: Record<string, WebPresence[]> = {};
  for (const m of raw.markets.nodes) {
    presences[m.id] = (m.webPresences?.nodes ?? []).map((p) => ({
      domain: p.domain?.host ?? null,
      subfolder: p.subfolderSuffix ?? null,
      defaultLocale: "",
      rootUrls: p.rootUrls ?? [],
    }));
  }
  return { primaryUrl: raw.shop.primaryDomain?.url ?? "", presences };
}

const THEMES = `#graphql
  query Themes { themes(first: 50) { nodes { id name role } } }`;

/** Themes of the store. Needs the read_themes permission: callers handle the failure and ask for a theme id instead. */
export async function loadThemes(): Promise<Theme[]> {
  const raw = await adminGraphql<{ themes: { nodes: { id: string; name: string; role: string }[] } | null }>(THEMES);
  return (raw.themes?.nodes ?? [])
    .map((t) => ({ id: t.id, numericId: t.id.split("/").pop() ?? t.id, name: t.name, role: t.role }))
    .sort((a, b) => (a.role === "MAIN" ? -1 : b.role === "MAIN" ? 1 : a.name.localeCompare(b.name)));
}
