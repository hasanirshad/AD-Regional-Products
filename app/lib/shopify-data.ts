// Reads from Shopify (writes are in applyMove.ts). Raw answers go through parse.ts.
// UNVERIFIED against a real store: every query and mutation here still has
// to be run on dev-appsdapps. Errors are shown to the user as they are.

import { adminGraphql } from "./admin";
import {
  hiddenCatalogIds,
  parseMarkets,
  parseProduct,
  parseProfileSummary,
  type RawMarkets,
  type RawProduct,
  type RawProfileSummary,
} from "./parse";
import type { Market, Membership, ProductRow, ProfileSummary } from "./types";

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
    deliveryProfiles(first: 8, after: $after) {
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

export async function loadMarkets(): Promise<{ markets: Market[]; hiddenCatalogIds: string[] }> {
  const raw = await adminGraphql<RawMarkets>(MARKETS);
  return { markets: parseMarkets(raw), hiddenCatalogIds: hiddenCatalogIds(raw) };
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
  return out;
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

const PROFILE_ITEMS = `#graphql
  query ProfileItems($id: ID!, $after: String) {
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

/** Which shipping profile each product is in now (General is the default and is left out). */
export async function loadMembership(profiles: ProfileSummary[]): Promise<Membership> {
  const membership: Membership = {};
  for (const profile of profiles) {
    if (profile.isDefault || profile.variantCount === 0) continue;
    const key = profile.id;
    let after: string | null = null;
    for (let page = 0; page < 100; page++) {
      const data: {
        deliveryProfile: {
          profileItems: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: { product: { id: string } | null }[];
          };
        } | null;
      } = await adminGraphql(PROFILE_ITEMS, { id: profile.id, after });
      const items = data.deliveryProfile?.profileItems;
      if (!items) break;
      for (const n of items.nodes) if (n.product) membership[n.product.id] = key;
      if (!items.pageInfo.hasNextPage) break;
      after = items.pageInfo.endCursor;
    }
  }
  return membership;
}
