// Shared data shapes. Plain objects only, so the logic stays easy to test.

/** One shipping zone of a profile, with the countries it covers. */
export type ProfileZone = {
  id: string;
  name: string;
  locationGroupId: string;
  countries: string[];
  restOfWorld: boolean;
  /**
   * Active rates in the zone (first 10 read). 0 = the zone lists countries but nobody can check out there.
   * null = not read, treated as "has rates".
   */
  rateCount: number | null;
};

/** Light summary of every shipping profile in the store. */
export type ProfileSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  variantCount: number;
  locationGroupIds: string[];
  zoneIds: string[];
  zones: ProfileZone[];
  /** Countries the profile really ships to: countries of zones that have rates (or whose rates are unknown). */
  countries: string[];
  /** True when a zone with rates covers "Rest of world". */
  restOfWorld: boolean;
  /** Countries listed in zones that have NO active rate: shown in Shopify, but nobody can check out there. */
  unratedCountries: string[];
  /** True when the rates of every zone were read. False = zone rates are assumed. */
  ratesKnown: boolean;
  /** Number of active shipping rates. */
  rateCount: number;
  /** True when the profile has more zones than we read (the list is incomplete). */
  zonesTruncated: boolean;
};

export type MarketCountry = { code: string; name: string };

export type Market = {
  id: string;
  name: string;
  status: string;
  countries: MarketCountry[];
  /** Catalogues that belong to this market. */
  catalogs: MarketCatalog[];
};

// ---- Products ----------------------------------------------------------

export type ProductCatalog = { id: string; title: string };

/** A market's catalogue, with the publication id that publishing writes to. */
export type MarketCatalog = ProductCatalog & { publicationId?: string | null };

export type ProductRow = {
  id: string;
  /** The number at the end of the id, for admin links. */
  numericId: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  /** Market catalogues the product is published in. Empty = in none. */
  catalogs: ProductCatalog[];
  /** Number of variants (0 when not read). */
  variantCount: number;
};

export type Filters = {
  search: string;
  status: string;
  vendor: string;
  productType: string;
  tag: string;
  /** "" any, NONE, ANY, or a catalogue id. */
  catalog: string;
  /** "" any, NONE (General, no profile), or a shipping profile id. */
  profile: string;
};

/** product id -> the shipping profile that holds most of its variants, for products in a profile other than General. */
export type Membership = Record<string, string>;

/** How many variants of a product sit in one shipping profile. key = profile id, or GENERAL for the default profile. */
export type Part = { key: string; variants: number };

/**
 * product id -> where its variants are, largest first. Only products with at least one variant in a profile
 * other than General appear. More than one part = the variants are split across profiles.
 */
export type Parts = Record<string, Part[]>;
