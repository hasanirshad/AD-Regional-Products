// Reads from and writes to Shopify. Raw answers go through parse.ts.
// UNVERIFIED against a real store: every query and mutation here still has
// to be run on dev-appsdapps. Errors are shown to the user as they are.

import { adminGraphql, assertNoUserErrors } from "./admin";
import {
  parseGeneral,
  hiddenCatalogIds, parseMarkets,
  parseProduct,
  parseProfileSummary,
  type RawGeneral,
  type RawMarkets,
  type RawProduct,
  type RawProfileSummary,
} from "./parse";
import type { GeneralProfile, Group, Market, Membership, ProductRow, ProfileSummary } from "./types";

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

const GENERAL = `#graphql
  query General($id: ID!) {
    deliveryProfile(id: $id) {
      id
      name
      profileLocationGroups {
        locationGroup {
          id
          locations(first: 50) { nodes { id name } }
        }
        locationGroupZones(first: 50) {
          nodes {
            zone {
              id
              name
              countries {
                code { countryCode restOfWorld }
                provinces { code }
              }
            }
            methodDefinitions(first: 25) {
              nodes {
                name
                active
                description
                rateProvider {
                  __typename
                  ... on DeliveryRateDefinition { price { amount currencyCode } }
                }
                methodConditions {
                  field
                  operator
                  conditionCriteria {
                    __typename
                    ... on MoneyV2 { amount currencyCode }
                    ... on Weight { value unit }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

const CREATE_PROFILE = `#graphql
  mutation CreateProfile($profile: DeliveryProfileInput!) {
    deliveryProfileCreate(profile: $profile) {
      profile { id name }
      userErrors { field message }
    }
  }`;

const UPDATE_PROFILE = `#graphql
  mutation UpdateProfile($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      profile { id name }
      userErrors { field message }
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
export async function loadGeneral(id: string): Promise<GeneralProfile> {
  const data = await adminGraphql<{ deliveryProfile: RawGeneral | null }>(GENERAL, { id });
  if (!data.deliveryProfile) throw new Error("The General shipping profile could not be read.");
  return parseGeneral(data.deliveryProfile);
}

export async function createProfile(profile: unknown): Promise<string> {
  const data = await adminGraphql<{
    deliveryProfileCreate: {
      profile: { id: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(CREATE_PROFILE, { profile });
  assertNoUserErrors(data.deliveryProfileCreate.userErrors, "Creating the shipping profile");
  const id = data.deliveryProfileCreate.profile?.id;
  if (!id) throw new Error("Shopify did not return the new shipping profile.");
  return id;
}

export async function updateProfile(id: string, profile: unknown): Promise<void> {
  const data = await adminGraphql<{
    deliveryProfileUpdate: { userErrors: { field: string[] | null; message: string }[] };
  }>(UPDATE_PROFILE, { id, profile });
  assertNoUserErrors(data.deliveryProfileUpdate.userErrors, "Updating the shipping profile");
}

// ---- Products ----------------------------------------------------------

// 25 per page with up to 10 catalogues each keeps one request well under
// Shopify's per-query cost limit.
const PRODUCTS = `#graphql
  query Products($after: String) {
    products(first: 25, after: $after, sortKey: TITLE) {
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

export async function loadProductsPage(
  after: string | null,
): Promise<{ rows: ProductRow[]; hasNext: boolean; cursor: string | null }> {
  const data = await adminGraphql<{
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawProduct[];
    };
  }>(PRODUCTS, { after });
  return {
    rows: data.products.nodes.map(parseProduct),
    hasNext: data.products.pageInfo.hasNextPage,
    cursor: data.products.pageInfo.endCursor,
  };
}

/** Which group each product is in now, read from the groups' shipping profiles. */
export async function loadMembership(groups: Group[], profiles: ProfileSummary[]): Promise<Membership> {
  const membership: Membership = {};
  for (const g of groups) {
    const profile = g.profileId ? profiles.find((p) => p.id === g.profileId) : undefined;
    if (!profile) continue;
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
      for (const n of items.nodes) if (n.product) membership[n.product.id] = g.id;
      if (!items.pageInfo.hasNextPage) break;
      after = items.pageInfo.endCursor;
    }
  }
  return membership;
}
