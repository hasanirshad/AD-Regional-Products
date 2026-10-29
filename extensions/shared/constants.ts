// ============================================================================
// STORE-SPECIFIC VALUES. This is the only file to edit when the store changes.
// Nothing here is read from Shopify. Check every line marked CONFIRM.
// ============================================================================

export type MarketDef = {
  /** Short label shown in the blocks. */
  key: string;
  label: string;
  /** ISO country code used to ask Shopify for the price in that market. */
  country: string;
  /** Storefront domain (no https://, no trailing slash). A subfolder is fine: "example.com/fr". */
  domain: string;
  /** The US storefront redirects visitors from elsewhere unless ?stay_us=1 is added. */
  stayUs?: boolean;
  /** Only needed if the market cannot be found by its country (two markets share the country). Use the market handle. */
  marketHandle?: string;
  /** The language the market sells in when it is not the store's main language (Shopify locale code). "" = the main language. */
  locale?: string;
};

/** The markets shown in the Market Availability and Sale blocks, in this order. */
export const MARKETS: MarketDef[] = [
  { key: "FR", label: "France", country: "FR", domain: "hardmandesign.fr", locale: "fr" }, // CONFIRM domain
  { key: "DE", label: "Germany", country: "DE", domain: "hardmandesign.de", locale: "de" }, // CONFIRM domain
  { key: "NL", label: "Netherlands", country: "NL", domain: "hardmandesign.nl", locale: "nl" }, // CONFIRM domain
  { key: "CH", label: "Switzerland", country: "CH", domain: "hardmandesign.ch", locale: "de" }, // CONFIRM domain and language
  { key: "UK", label: "United Kingdom", country: "GB", domain: "hardmandesigns.com" }, // CONFIRM domain
  { key: "US", label: "United States", country: "US", domain: "hardmandesign.com", stayUs: true }, // CONFIRM domain
];

/** Markets the store treats as not existing (name AND handle must match). Same rule as the Regional Products app. */
export const HIDDEN_MARKETS: { name: string; handle: string }[] = [{ name: "Global", handle: "de" }];

/** Languages checked in the Translation Status and Sale blocks (Shopify locale codes, source language excluded). */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "fr", label: "French" }, // CONFIRM the list of published languages
  { code: "de", label: "German" },
  { code: "nl", label: "Dutch" },
];

/** Sale badge text (a product metafield). */
export const SALE_BADGE = { namespace: "custom", key: "sale_badge" };

/** Handle of the collection that holds sale products. CONFIRM. */
export const SALE_COLLECTION_HANDLE = "sale";

/** Product metafield namespaces whose text values are checked for translations. */
export const TRANSLATED_METAFIELD_NAMESPACES = ["custom"];

/** Numeric id of the theme to preview in Quick Links. Leave "" to hide that link. CONFIRM. */
export const PREVIEW_THEME_ID = "";
/** Which market's domain the preview link uses (a `key` from MARKETS). */
export const PREVIEW_MARKET_KEY = "UK";

export type FieldDef = {
  label: string;
  namespace: string;
  key: string;
  /** Where the metafield lives. "variant": every variant must have it. */
  owner: "product" | "variant";
};

/**
 * Metafields the Data Quality block expects to be filled.
 * length and seater: taken from the collection page code (custom.variant_length, custom.variant_table_person_space). CONFIRM.
 * leadTime: NOT KNOWN yet. Add the keys here; until then the check shows "Not configured" and is left out of the count.
 */
export const REQUIRED_FIELDS: { length: FieldDef[]; seater: FieldDef[]; leadTime: FieldDef[] } = {
  length: [{ label: "Length", namespace: "custom", key: "variant_length", owner: "variant" }],
  seater: [{ label: "Seater", namespace: "custom", key: "variant_table_person_space", owner: "variant" }],
  leadTime: [],
};

/** How many recent events the Recent Activity block lists. */
export const EVENTS_LIMIT = 20;
