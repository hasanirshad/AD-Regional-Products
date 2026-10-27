// Languages and "slots". A slot is one place a translation lives: a language ("fr"), or a language adapted for one
// market ("en@gid://shopify/Market/1"). The editor shows one input per slot. Today the slots are the store's own
// languages; the market form is kept so adaptations can be added without changing the rest. Pure.

export const MARKET_SEPARATOR = "@";

export type ShopLocale = {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
};

/** One input column. */
export type Slot = {
  /** The slot key: "fr" or "en@<market gid>". */
  key: string;
  /** Short label for a column heading, for example "French". */
  label: string;
  locale: string;
  marketId: string | null;
  published: boolean;
};

export const slotKey = (locale: string, marketId?: string | null): string => (marketId ? `${locale}${MARKET_SEPARATOR}${marketId}` : locale);

export function parseSlot(key: string): { locale: string; marketId: string | null } {
  const at = key.indexOf(MARKET_SEPARATOR);
  if (at < 0) return { locale: key, marketId: null };
  return { locale: key.slice(0, at), marketId: key.slice(at + 1) || null };
}

/** Every store language except the primary one, in the order Shopify lists them. */
export function slotsFromLocales(locales: ShopLocale[]): Slot[] {
  return locales
    .filter((l) => !l.primary)
    .map((l) => ({ key: l.locale, label: l.name, locale: l.locale, marketId: null, published: l.published }));
}

export const primaryLocale = (locales: ShopLocale[]): ShopLocale | undefined => locales.find((l) => l.primary);
