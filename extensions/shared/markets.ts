// The one place that decides, for a product, which markets it is published in. Market availability and Storefront
// readiness (and the Markets checks of Product health) all use it, so they can never disagree.

import { HIDDEN_MARKETS, type MarketDef } from "./constants";
import type { SoftQuery } from "./query";

export type RawMarket = {
  id: string;
  name: string;
  handle: string;
  status?: string | null;
  catalogs?: { nodes: { id: string; title?: string }[] } | null;
  conditions?: { regionsCondition?: { regions?: { nodes: { __typename?: string; code?: string }[] } | null } | null } | null;
};

/** The part of a query that asks for the markets. */
export const MARKETS_SELECTION = `markets(first: 100) { nodes { id name handle status catalogs(first: 10) { nodes { id title } } conditions { regionsCondition { regions(first: 250) { nodes { __typename ... on MarketRegionCountry { code } } } } } } }`;

export const MARKETS_QUERY = `query FactsMarkets { ${MARKETS_SELECTION} }`;

export type PublishState = "published" | "not-published" | "no-market";

export type MarketState = {
  def: MarketDef;
  marketId: string | null;
  marketName: string | null;
  marketStatus: string | null;
  state: PublishState;
};

const isHidden = (m: RawMarket) => HIDDEN_MARKETS.some((h) => h.name === m.name && h.handle === m.handle);

/** The market for a row: by handle when the settings name one, else the first market that contains the country. */
export function findMarket(def: MarketDef, markets: RawMarket[]): RawMarket | null {
  const visible = markets.filter((m) => !isHidden(m));
  if (def.marketHandle) return visible.find((m) => m.handle === def.marketHandle) ?? null;
  return visible.find((m) => m.conditions?.regionsCondition?.regions?.nodes.some((r) => r.code === def.country)) ?? null;
}

/** Published / not published / no such market, per listed market. `published` are the catalogue ids the product is published in. */
export function marketStates(defs: MarketDef[], markets: RawMarket[], published: Iterable<string>): MarketState[] {
  const set = new Set(published);
  return defs.map((def): MarketState => {
    const market = findMarket(def, markets);
    const ids = market?.catalogs?.nodes.map((c) => c.id) ?? [];
    const state: PublishState = !market ? "no-market" : ids.some((id) => set.has(id)) ? "published" : "not-published";
    return { def, marketId: market?.id ?? null, marketName: market?.name ?? null, marketStatus: market?.status ?? null, state };
  });
}


/** Reads the markets and says which the product is published in. null = the market list could not be read. */
export async function readMarketStates(soft: SoftQuery, defs: MarketDef[], published: Iterable<string>): Promise<MarketState[] | null> {
  const res = await soft<{ markets: { nodes: RawMarket[] } }>(MARKETS_QUERY);
  if (!res.data?.markets) return null;
  return marketStates(defs, res.data.markets.nodes, published);
}
