// Price of a product in each market, shared by the Market Availability and Sale and Badge blocks.
// Primary read: Product.contextualPricing (lowest and highest priced variant per market, cheap).
// If Shopify does not know that field, fall back to the first variants one by one.

import { BlockError, countryEnum, type Query } from "./graphql";
import { parseMoney, type Money } from "./format";

export type Quote = { price: Money | null; compareAt: Money | null };
export type MarketPrice = { low: Quote; high: Quote };
export type PriceMap = Record<string, MarketPrice | null>;
export type PriceResult = { prices: PriceMap; /** Set when the prices come from the first few variants only. */ note: string | null };

const SAMPLED_VARIANTS = 30;

const MONEY = "{ amount currencyCode }";
const QUOTE = `{ price ${MONEY} compareAtPrice ${MONEY} }`;

/** Aliased fields to put inside `product { ... }`. */
export function pricingSelection(countries: string[]): string {
  return countries
    .map((c) => `p_${countryEnum(c)}: contextualPricing(context: { country: ${c} }) { minVariantPricing ${QUOTE} maxVariantPricing ${QUOTE} }`)
    .join("\n    ");
}

type RawQuote = { price?: { amount?: string; currencyCode?: string } | null; compareAtPrice?: { amount?: string; currencyCode?: string } | null } | null | undefined;
const quote = (r: RawQuote): Quote => ({ price: parseMoney(r?.price), compareAt: parseMoney(r?.compareAtPrice) });

/** Read the aliased pricing out of a product object. */
export function readPricing(product: Record<string, unknown> | null | undefined, countries: string[]): PriceMap {
  const out: PriceMap = {};
  for (const c of countries) {
    const raw = product?.[`p_${c}`] as { minVariantPricing?: RawQuote; maxVariantPricing?: RawQuote } | null | undefined;
    out[c] = raw ? { low: quote(raw.minVariantPricing), high: quote(raw.maxVariantPricing) } : null;
  }
  return out;
}

const VARIANT_SELECTION = (countries: string[]) => countries.map((c) => `p_${countryEnum(c)}: contextualPricing(context: { country: ${c} }) ${QUOTE}`).join("\n        ");

/** The fallback: price per market from the first variants. */
export async function loadSampledPricing(q: Query, productId: string, countries: string[]): Promise<PriceResult> {
  const data = await q<{ product: { variantsCount?: { count: number } | null; variants: { nodes: Record<string, RawQuote>[] } } | null }>(
    `query SampledPricing($id: ID!) {
      product(id: $id) {
        variantsCount { count }
        variants(first: ${SAMPLED_VARIANTS}) {
          nodes {
        ${VARIANT_SELECTION(countries)}
          }
        }
      }
    }`,
    { id: productId },
  );
  const nodes = data.product?.variants.nodes ?? [];
  const total = data.product?.variantsCount?.count ?? nodes.length;
  const prices: PriceMap = {};
  for (const c of countries) {
    const quotes = nodes.map((n) => quote(n[`p_${c}`])).filter((x) => x.price);
    if (!quotes.length) {
      prices[c] = null;
      continue;
    }
    const sorted = [...quotes].sort((a, b) => (a.price?.amount ?? 0) - (b.price?.amount ?? 0));
    prices[c] = { low: sorted[0]!, high: sorted[sorted.length - 1]! };
  }
  return {
    prices,
    note: total > nodes.length ? `Prices come from the first ${nodes.length} of ${total} variants.` : null,
  };
}

/**
 * Runs `run(selection)` (which must return the product object with the pricing fields inside it).
 * If Shopify rejects the pricing fields, runs `run("")` and reads the prices another way.
 */
export async function withPricing<P extends { product: unknown }>(
  q: Query,
  productId: string,
  countries: string[],
  run: (selection: string) => Promise<P>,
): Promise<{ result: P; pricing: PriceResult }> {
  try {
    const result = await run(pricingSelection(countries));
    return { result, pricing: { prices: readPricing(result.product as Record<string, unknown> | null, countries), note: null } };
  } catch (e) {
    if (!(e instanceof BlockError) || e.kind !== "schema" || !/contextualPricing|minVariantPricing|maxVariantPricing|ContextualPricing/i.test(e.detail)) throw e;
  }
  const [result, pricing] = await Promise.all([run(""), loadSampledPricing(q, productId, countries)]);
  return { result, pricing };
}

