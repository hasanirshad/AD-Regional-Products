import type { MarketDef } from "../../shared/constants";
import { findMarket, MARKETS_SELECTION, marketStates, type PublishState, type RawMarket } from "../../shared/markets";
import { withPricing, type MarketPrice } from "../../shared/pricing";
import type { LoadContext } from "../../shared/query";
import { defaultSettings, marketCountries, marketDefs, settingsOf } from "../../shared/settings";

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
  ${MARKETS_SELECTION}
}`;

export { findMarket, type PublishState };

export type MarketRow = {
  def: MarketDef;
  /** Read-only extras. null = not known (permission missing or the market was not found). */
  shipping?: string | null;
  returns?: string | null;
  marketName: string | null;
  marketStatus: string | null;
  state: PublishState;
  price: MarketPrice | null;
};

export type Data = { productStatus: string; rows: MarketRow[]; note: string | null; extrasNote?: string | null };

export function shape(raw: Raw, prices: Record<string, MarketPrice | null>, note: string | null, defs: MarketDef[] = marketDefs(defaultSettings())): Data {
  const published = (raw.product?.resourcePublicationsV2?.nodes ?? []).map((n) => n.publication?.catalog?.id).filter((x): x is string => !!x);
  const rows = marketStates(defs, raw.markets.nodes, published).map((m): MarketRow => ({ def: m.def, marketName: m.marketName, marketStatus: m.marketStatus, state: m.state, price: prices[m.def.country] ?? null }));
  return { productStatus: raw.product?.status ?? "", rows, note };
}

type RulesRaw = {
  markets: { nodes: { id: string; delivery?: { shipping?: { isEnabled: boolean } | null } | null; returnPolicyProfile?: { name?: string | null; default?: boolean; returnRules?: { canAcceptReturns: boolean; returnWindowDays?: number | null } | null } | null }[] };
};

/** Two small read-only questions, asked apart so a missing permission on one never hides the other. */
export const SHIPPING_QUERY = `query MarketShipping { markets(first: 100) { nodes { id delivery { shipping { isEnabled } } } } }`;
export const RETURNS_QUERY = `query MarketReturns { markets(first: 100) { nodes { id returnPolicyProfile { name default returnRules { canAcceptReturns returnWindowDays } } } } }`;

export function shippingWords(node: RulesRaw["markets"]["nodes"][number] | undefined): string | null {
  if (!node) return null;
  const s = node.delivery?.shipping;
  if (!s) return "Inherited";
  return s.isEnabled ? "On" : "Off";
}

export function returnsWords(node: RulesRaw["markets"]["nodes"][number] | undefined): string | null {
  if (!node) return null;
  const p = node.returnPolicyProfile;
  if (!p) return "Store default";
  const r = p.returnRules;
  const label = p.name ? `${p.name}: ` : "";
  if (!r) return `${label}returns unrestricted`;
  if (!r.canAcceptReturns) return `${label}no returns`;
  if (r.returnWindowDays === -1) return `${label}no time limit`;
  return r.returnWindowDays != null ? `${label}${r.returnWindowDays} days` : `${label}returns accepted`;
}

/** Adds the read-only shipping and returns words to the rows. Pure, so it is tested without Shopify. */
export function withRules(data: Data, markets: RawMarket[], shipping: RulesRaw | null, returns: RulesRaw | null): Data {
  const rows = data.rows.map((row) => {
    const market = findMarket(row.def, markets);
    const id = market?.id;
    return {
      ...row,
      shipping: shipping ? shippingWords(shipping.markets.nodes.find((n) => n.id === id)) : null,
      returns: returns ? returnsWords(returns.markets.nodes.find((n) => n.id === id)) : null,
    };
  });
  return { ...data, rows };
}

export async function load(ctx: LoadContext): Promise<Data> {
  const { productId, q } = ctx;
  const defs = marketDefs(settingsOf(ctx));
  const countries = marketCountries(defs);
  const { result, pricing } = await withPricing(q, productId, countries, (selection) => q<Raw>(query(selection), { id: productId }));
  if (!result.product) throw new Error("Product not found");
  const base = shape(result, pricing.prices, pricing.note, defs);
  const [ship, ret] = await Promise.all([ctx.soft<RulesRaw>(SHIPPING_QUERY), ctx.soft<RulesRaw>(RETURNS_QUERY)]);
  const out = withRules(base, result.markets.nodes, ship.error ? null : ship.data, ret.error ? null : ret.data);
  out.extrasNote = ret.error ? "Return rules are not shown yet. Deploy the app and approve the new read_legal_policies permission in the store." : null;
  return out;
}

