import { HIDDEN_MARKETS, MARKETS, type MarketDef } from "../../shared/constants";
import { withPricing, type MarketPrice } from "../../shared/pricing";
import type { LoadContext } from "../../shared/index";

type RawMarket = {
  id: string;
  name: string;
  handle: string;
  status?: string | null;
  catalogs?: { nodes: { id: string; title?: string }[] } | null;
  conditions?: { regionsCondition?: { regions?: { nodes: { __typename?: string; code?: string }[] } | null } | null } | null;
};

type Raw = {
  product: (Record<string, unknown> & { id: string; status: string; resourcePublicationsV2?: { nodes: { publication?: { catalog?: { id: string } | null } | null }[] } | null }) | null;
  markets: { nodes: RawMarket[] };
};

const query = (selection: string) => `query MarketAvailability($id: ID!) {
  product(id: $id) {
    id
    status
    resourcePublicationsV2(first: 20, onlyPublished: true, catalogType: MARKET) {
      nodes { publication { catalog { id } } }
    }
    ${selection}
  }
  markets(first: 100) {
    nodes {
      id
      name
      handle
      status
      catalogs(first: 10) { nodes { id title } }
      conditions { regionsCondition { regions(first: 250) { nodes { __typename ... on MarketRegionCountry { code } } } } }
    }
  }
}`;

export type PublishState = "published" | "not-published" | "no-market";

export type MarketRow = {
  def: MarketDef;
  marketName: string | null;
  marketStatus: string | null;
  state: PublishState;
  price: MarketPrice | null;
};

export type Data = { productStatus: string; rows: MarketRow[]; note: string | null };

const isHidden = (m: RawMarket) => HIDDEN_MARKETS.some((h) => h.name === m.name && h.handle === m.handle);

/** The market for a row: by handle when the constants name one, else the first market that contains the country. */
export function findMarket(def: MarketDef, markets: RawMarket[]): RawMarket | null {
  const visible = markets.filter((m) => !isHidden(m));
  if (def.marketHandle) return visible.find((m) => m.handle === def.marketHandle) ?? null;
  return visible.find((m) => m.conditions?.regionsCondition?.regions?.nodes.some((r) => r.code === def.country)) ?? null;
}

export function shape(raw: Raw, prices: Record<string, MarketPrice | null>, note: string | null): Data {
  const publishedCatalogs = new Set((raw.product?.resourcePublicationsV2?.nodes ?? []).map((n) => n.publication?.catalog?.id).filter((x): x is string => !!x));
  const rows = MARKETS.map((def): MarketRow => {
    const market = findMarket(def, raw.markets.nodes);
    const catalogIds = market?.catalogs?.nodes.map((c) => c.id) ?? [];
    const state: PublishState = !market ? "no-market" : catalogIds.some((id) => publishedCatalogs.has(id)) ? "published" : "not-published";
    return { def, marketName: market?.name ?? null, marketStatus: market?.status ?? null, state, price: prices[def.country] ?? null };
  });
  return { productStatus: raw.product?.status ?? "", rows, note };
}

export async function load({ productId, q }: LoadContext): Promise<Data> {
  const countries = MARKETS.map((m) => m.country);
  const { result, pricing } = await withPricing(q, productId, countries, (selection) => q<Raw>(query(selection), { id: productId }));
  if (!result.product) throw new Error("Product not found");
  return shape(result, pricing.prices, pricing.note);
}

