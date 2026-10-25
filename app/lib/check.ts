// "Product check": one product, followed from its status through its catalogues and shipping profiles
// to what a customer in each market and country can actually do. Pure functions, no Shopify calls.

import { GENERAL, NO_PROFILE } from "./keys";
import { shipsTo } from "./overview";
import type { Market, ProfileSummary } from "./types";

/** One product as read fresh by `loadProductDetail`. */
export type ProductDetail = {
  id: string;
  numericId: string;
  title: string;
  status: string;
  /** Market catalogues the product is published in. */
  catalogs: { id: string; title: string }[];
  variants: VariantInfo[];
  /** False when the product has more variants than were read. */
  variantsComplete: boolean;
  variantTotal: number;
};

export type VariantInfo = { id: string; title: string; sku: string; profileKey: string };

export type Result = "buy" | "partial" | "cannot" | "hidden";

export type MarketCheck = {
  marketId: string;
  name: string;
  marketActive: boolean;
  /** In at least one catalogue of the market. */
  published: boolean;
  /** The market's catalogues the product is in. */
  inCatalogs: string[];
  ships: "all" | "some" | "none";
  /** Countries of the market that cannot check out. */
  blocked: string[];
  result: Result;
  reason: string;
};

export type CountryCheck = {
  code: string;
  name: string;
  market: string;
  visible: boolean;
  checkout: boolean;
  result: Result;
  reason: string;
};

export type CatalogCheck = { id: string; title: string; market: string; inIt: boolean };

export type ProfileCheck = {
  key: string;
  name: string;
  isGeneral: boolean;
  /** How many of this product's variants are in it. */
  variants: number;
  ships: string[];
  restOfWorld: boolean;
  /** Zones that list countries but have no active rate. */
  noRateZones: string[];
};

export type VariantCheck = {
  id: string;
  title: string;
  sku: string;
  profileName: string;
  perMarket: Record<string, "all" | "some" | "none">;
};

export type ProductCheck = {
  headline: { tone: "success" | "warning" | "critical" | "neutral"; text: string };
  notes: string[];
  markets: MarketCheck[];
  countries: CountryCheck[];
  catalogs: CatalogCheck[];
  profiles: ProfileCheck[];
  /** True when the variants are in different shipping profiles. */
  split: boolean;
  /** Per variant. Only filled when the variants differ in shipping profile. */
  variants: VariantCheck[];
};

const STATUS_NAME: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };

export function buildProductCheck(input: { detail: ProductDetail; markets: Market[]; profiles: ProfileSummary[] }): ProductCheck {
  const { detail, markets, profiles } = input;
  const active = detail.status === "ACTIVE";
  const profileOf = (key: string): ProfileSummary | null =>
    key === GENERAL ? (profiles.find((p) => p.isDefault) ?? null) : (profiles.find((p) => p.id === key) ?? null);
  const nameOf = (key: string) => (key === GENERAL ? "General" : key === NO_PROFILE ? "No profile" : (profileOf(key)?.name ?? "Unknown profile"));

  // Where the variants are: one group per profile.
  const groups = new Map<string, number>();
  for (const v of detail.variants) groups.set(v.profileKey, (groups.get(v.profileKey) ?? 0) + 1);
  const keys = [...groups.keys()];
  const split = keys.length > 1;

  const inIds = new Set(detail.catalogs.map((c) => c.id));

  /** For one country: the profiles of this product that do not ship there, with the reason. */
  const lackingFor = (code: string): string[] => {
    const out: string[] = [];
    for (const key of keys) {
      const p = profileOf(key);
      if (key === NO_PROFILE) out.push("some variants have no shipping profile");
      else if (!p) out.push(`${nameOf(key)} was not found`);
      else if (!shipsTo(p, code)) {
        out.push(p.unratedCountries.includes(code) ? `${p.name} lists it in a zone with no rates` : `${p.name} does not ship there`);
      }
    }
    return out;
  };
  const shipsEverywhere = (code: string) => keys.length > 0 && lackingFor(code).length === 0;

  const marketChecks: MarketCheck[] = markets.map((m) => {
    const inCatalogs = m.catalogs.filter((c) => inIds.has(c.id)).map((c) => c.title);
    const published = inCatalogs.length > 0;
    const marketActive = m.status === "ACTIVE";
    const blocked = m.countries.filter((c) => !shipsEverywhere(c.code)).map((c) => c.code);
    const ships: MarketCheck["ships"] = blocked.length === 0 ? "all" : blocked.length === m.countries.length ? "none" : "some";
    let result: Result;
    let reason: string;
    if (!active) {
      result = "hidden";
      reason = `The product is ${STATUS_NAME[detail.status] ?? detail.status}, so it is not sold.`;
    } else if (!marketActive) {
      result = "hidden";
      reason = "The market is not active.";
    } else if (!published) {
      result = "hidden";
      reason = m.catalogs.length === 0 ? "The market has no catalogue." : "The product is not in this market's catalogue.";
    } else if (m.countries.length === 0) {
      result = "cannot";
      reason = "The market has no countries.";
    } else if (ships === "all") {
      result = "buy";
      reason = "";
    } else {
      result = ships === "none" ? "cannot" : "partial";
      const why = [...new Set(m.countries.flatMap((c) => lackingFor(c.code)))];
      reason = why.join("; ");
    }
    return { marketId: m.id, name: m.name, marketActive, published, inCatalogs, ships, blocked, result, reason };
  });

  const countryChecks: CountryCheck[] = markets.flatMap((m) => {
    const mc = marketChecks.find((x) => x.marketId === m.id)!;
    return m.countries.map((c): CountryCheck => {
      const visible = active && mc.marketActive && mc.published;
      const checkout = shipsEverywhere(c.code);
      const lacking = lackingFor(c.code);
      const result: Result = !visible ? "hidden" : checkout ? "buy" : "cannot";
      const reason = !visible ? mc.reason : checkout ? "" : lacking.join("; ");
      return { code: c.code, name: c.name, market: m.name, visible, checkout, result, reason };
    });
  });

  const catalogChecks: CatalogCheck[] = markets.flatMap((m) =>
    m.catalogs.map((c) => ({ id: c.id, title: c.title, market: m.name, inIt: inIds.has(c.id) })),
  );

  const profileChecks: ProfileCheck[] = [
    ...profiles.filter((p) => p.isDefault),
    ...profiles.filter((p) => !p.isDefault),
  ].map((p) => ({
    key: p.isDefault ? GENERAL : p.id,
    name: p.isDefault ? "General" : p.name,
    isGeneral: p.isDefault,
    variants: groups.get(p.isDefault ? GENERAL : p.id) ?? 0,
    ships: p.countries,
    restOfWorld: p.restOfWorld,
    noRateZones: p.zones.filter((z) => z.rateCount === 0 && (z.countries.length > 0 || z.restOfWorld)).map((z) => z.name),
  }));

  const variantChecks: VariantCheck[] = split
    ? detail.variants.map((v) => {
        const p = profileOf(v.profileKey);
        const perMarket: VariantCheck["perMarket"] = {};
        for (const m of markets) {
          const ok = m.countries.filter((c) => shipsTo(p, c.code)).length;
          perMarket[m.id] = m.countries.length > 0 && ok === m.countries.length ? "all" : ok === 0 ? "none" : "some";
        }
        return { id: v.id, title: v.title, sku: v.sku, profileName: nameOf(v.profileKey), perMarket };
      })
    : [];

  // ---- One-line answer --------------------------------------------------
  const notes: string[] = [];
  if (split) notes.push("The variants are in different shipping profiles. A country can buy the product only where every profile ships.");
  if (!detail.variantsComplete) notes.push(`Only the first ${detail.variants.length} of ${detail.variantTotal} variants were read.`);
  if (keys.includes(NO_PROFILE)) notes.push("Some variants have no shipping profile.");
  if (detail.variants.length === 0) notes.push("The product has no variants.");

  const buy = marketChecks.filter((m) => m.result === "buy");
  const partial = marketChecks.filter((m) => m.result === "partial");
  const cannot = marketChecks.filter((m) => m.result === "cannot");
  let headline: ProductCheck["headline"];
  if (!active) {
    headline = { tone: "neutral", text: `Not for sale: the product is ${STATUS_NAME[detail.status] ?? detail.status}.` };
  } else if (marketChecks.length > 0 && buy.length === marketChecks.length) {
    headline = { tone: "success", text: `Can be bought in all ${buy.length} markets.` };
  } else if (cannot.length + partial.length > 0) {
    const parts: string[] = [];
    if (buy.length) parts.push(`can be bought in ${buy.map((m) => m.name).join(", ")}`);
    if (partial.length) parts.push(`only partly in ${partial.map((m) => m.name).join(", ")}`);
    if (cannot.length) parts.push(`visible but cannot check out in ${cannot.map((m) => m.name).join(", ")}`);
    const text = parts.join("; ");
    headline = { tone: cannot.length ? "critical" : "warning", text: text.charAt(0).toUpperCase() + text.slice(1) + "." };
  } else if (buy.length > 0) {
    headline = { tone: "warning", text: `Can be bought in ${buy.map((m) => m.name).join(", ")}. Not visible in the other markets.` };
  } else {
    headline = { tone: "warning", text: "Not visible in any market." };
  }

  return { headline, notes, markets: marketChecks, countries: countryChecks, catalogs: catalogChecks, profiles: profileChecks, split, variants: variantChecks };
}
