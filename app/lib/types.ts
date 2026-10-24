// Shared data shapes. Plain objects only, so the logic stays easy to test.

/** One shipping zone of a profile, with the countries it covers. */
export type ProfileZone = {
  id: string;
  name: string;
  locationGroupId: string;
  countries: string[];
  restOfWorld: boolean;
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
  /** Countries the profile ships to, read live (explicit zone countries). */
  countries: string[];
  /** True when a zone covers "Rest of world". */
  restOfWorld: boolean;
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

/** product id -> shipping profile id, for products in a profile other than General. */
export type Membership = Record<string, string>;
