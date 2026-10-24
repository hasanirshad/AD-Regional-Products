// Shared data shapes. Plain objects only, so the logic stays easy to test.

export type Operator = "GREATER_THAN_OR_EQUAL_TO" | "LESS_THAN_OR_EQUAL_TO";

export type Money = { amount: string; currencyCode: string };

export type RateCondition =
  | { kind: "weight"; operator: Operator; value: number; unit: string }
  | { kind: "price"; operator: Operator; amount: string; currencyCode: string };

export type Method = {
  name: string;
  description: string | null;
  active: boolean;
  /** "rate" = a fixed rate we can copy. "carrier" = calculated by a carrier. */
  kind: "rate" | "carrier" | "unknown";
  price: Money | null;
  conditions: RateCondition[];
  /** Set when a condition has a type we do not know how to copy. */
  unsupported: string | null;
};

export type ZoneCountry = {
  /** ISO code, or null for the "Rest of world" entry. */
  code: string | null;
  restOfWorld: boolean;
  /** Selected province codes. Empty = all provinces. */
  provinces: string[];
};

export type Zone = {
  id: string;
  name: string;
  countries: ZoneCountry[];
  methods: Method[];
};

export type LocationGroup = {
  id: string;
  locations: { id: string; name: string }[];
  zones: Zone[];
};

/** The General profile in full: where rates are copied from. */
export type GeneralProfile = {
  id: string;
  name: string;
  locationGroups: LocationGroup[];
};

/** Light summary of every shipping profile in the store. */
export type ProfileSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  variantCount: number;
  locationGroupIds: string[];
  zoneIds: string[];
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

/** A group as the app saves it (one app metafield). */
export type Group = {
  id: string;
  name: string;
  /** Allowed countries, ISO codes. */
  countries: string[];
  /** The Shopify shipping profile made for this group, once it exists. */
  profileId: string | null;
};

export type GroupsFile = { version: 1; groups: Group[] };

// ---- Planning ----------------------------------------------------------

export type PlannedZone = {
  name: string;
  countries: ZoneCountry[];
  methods: Method[];
  skipped: { name: string; reason: string }[];
};

export type PlannedLocationGroup = {
  locationIds: string[];
  locationNames: string[];
  zones: PlannedZone[];
};

export type ProfilePlan = {
  locationGroups: PlannedLocationGroup[];
  warnings: string[];
  /** Allowed countries that end up with a usable rate. */
  covered: string[];
  /** Allowed countries with no usable rate in General. */
  uncovered: string[];
};

export type MarketResult = {
  market: Market;
  /** all = every country allowed, none = no country allowed, mixed = some. */
  state: "all" | "none" | "mixed";
  allowed: MarketCountry[];
  blocked: MarketCountry[];
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
  /** "" any, NONE (not in a group), or a group id. */
  group: string;
};

/** product id -> group id, for products currently in a group's shipping profile. */
export type Membership = Record<string, string>;
