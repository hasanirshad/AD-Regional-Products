// Languages and "slots". A slot is one place a translation lives: a language ("fr"), or a language adapted for one
// market ("en@gid://shopify/Market/1"). The editor shows one input per slot. Today the slots are the store's own
// languages plus the adaptations chosen on the Settings page (a language adapted for one market). Pure.

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

/** A language adapted for one market, as chosen on the Settings page. */
export type Adaptation = { locale: string; marketId: string; marketName: string };

/**
 * The store's languages, then one extra slot for each adaptation (a language for one market). An adaptation whose
 * language is no longer on the store, or whose market no longer exists, is left out; its saved texts stay in Shopify.
 * `marketIds` null means the markets are not known yet: no adaptation is shown until they are.
 */
export function slotsWithAdaptations(locales: ShopLocale[], adaptations: Adaptation[], marketIds: ReadonlySet<string> | null): Slot[] {
  const base = slotsFromLocales(locales);
  if (!marketIds) return base;
  const extra: Slot[] = [];
  for (const a of adaptations) {
    const locale = locales.find((l) => l.locale === a.locale);
    if (!locale || !marketIds.has(a.marketId)) continue;
    const key = slotKey(a.locale, a.marketId);
    if (base.some((s) => s.key === key) || extra.some((s) => s.key === key)) continue;
    extra.push({ key, label: `${locale.name} · ${a.marketName}`, locale: a.locale, marketId: a.marketId, published: locale.published });
  }
  return [...base, ...extra];
}

export const primaryLocale = (locales: ShopLocale[]): ShopLocale | undefined => locales.find((l) => l.primary);
