// What moving products into a shipping profile (or back to General) would change.
// Pure planning, used for the review step. Nothing here writes to Shopify.

import {
  coverage,
  GENERAL,
  isPublishedIn,
  sellingMarkets,
  type Coverage,
  type Shipper,
} from "./overview";
import type { Market, MarketCatalog, Membership, ProductRow } from "./types";

/**
 * full: publish where the profile ships, unpublish where it ships nowhere.
 * unpublish: only remove products from markets the profile cannot sell to.
 * none: leave catalogues alone.
 */
export type VisibilityMode = "full" | "unpublish" | "none";

export type CatalogChange = { market: Market; catalog: MarketCatalog; kind: "publish" | "unpublish" };

export type MoveLine = {
  product: ProductRow;
  from: string;
  to: string;
  shippingChange: boolean;
  changes: CatalogChange[];
};

export type MarketEffect = { coverage: Coverage; publish: number; unpublish: number };

export type MovePlan = {
  target: Shipper;
  mode: VisibilityMode;
  /** Products with something to change. */
  lines: MoveLine[];
  /** Products with nothing to change. */
  unchanged: ProductRow[];
  perMarket: MarketEffect[];
  totals: { shipping: number; publish: number; unpublish: number };
  /** Why Apply is not possible. Null when it is. */
  blocker: string | null;
  warnings: string[];
};

export function planMove(input: {
  products: ProductRow[];
  membership: Membership;
  target: Shipper;
  shippers: Shipper[];
  markets: Market[];
  mode: VisibilityMode;
}): MovePlan {
  const { products, membership, target, shippers, mode } = input;
  const markets = sellingMarkets(input.markets);
  const covs = markets.map((m) => coverage(target.profile, m));
  const nameOf = (key: string) => shippers.find((s) => s.key === key)?.name ?? "unknown profile";
  const warnings: string[] = [];

  const lines: MoveLine[] = [];
  const unchanged: ProductRow[] = [];
  let missingPublication = false;

  for (const product of products) {
    const currentKey = membership[product.id] ?? GENERAL;
    const shippingChange = currentKey !== target.key;
    const changes: CatalogChange[] = [];

    if (mode !== "none" && product.status === "ACTIVE") {
      markets.forEach((market, i) => {
        const wantPublished = covs[i]?.state !== "none";
        for (const catalog of market.catalogs) {
          if (!catalog.publicationId) {
            missingPublication = true;
            continue;
          }
          const inCatalog = product.catalogs.some((c) => c.id === catalog.id);
          if (wantPublished && !inCatalog && mode === "full") changes.push({ market, catalog, kind: "publish" });
          if (!wantPublished && inCatalog) changes.push({ market, catalog, kind: "unpublish" });
        }
      });
    }

    if (!shippingChange && changes.length === 0) unchanged.push(product);
    else lines.push({ product, from: nameOf(currentKey), to: target.name, shippingChange, changes });
  }

  const perMarket: MarketEffect[] = markets.map((m, i) => ({
    coverage: covs[i]!,
    publish: lines.reduce((n, l) => n + l.changes.filter((c) => c.market.id === m.id && c.kind === "publish").length, 0),
    unpublish: lines.reduce((n, l) => n + l.changes.filter((c) => c.market.id === m.id && c.kind === "unpublish").length, 0),
  }));
  const totals = {
    shipping: lines.filter((l) => l.shippingChange).length,
    publish: perMarket.reduce((n, m) => n + m.publish, 0),
    unpublish: perMarket.reduce((n, m) => n + m.unpublish, 0),
  };

  let blocker: string | null = null;
  if (!target.profile) blocker = `"${target.name}" has no shipping profile in Shopify. It may have been deleted in Shopify.`;
  else if (lines.length === 0) blocker = "Nothing would change with these settings.";

  if (target.profile && target.profile.rateCount === 0) {
    warnings.push(`"${target.profile.name}" has no active shipping rates, so customers could not check out these products.`);
  }
  const drafts = products.filter((p) => p.status !== "ACTIVE").length;
  if (mode !== "none" && drafts > 0) {
    warnings.push(`${drafts} selected product${drafts === 1 ? " is" : "s are"} not active. Their shipping profile moves, but their catalogues are left alone.`);
  }
  if (missingPublication) {
    warnings.push("Some catalogues could not be read for publishing and will be skipped.");
  }
  if (mode === "unpublish" || mode === "none") {
    const noSell = perMarket.filter((m) => m.coverage.state === "none").length;
    if (mode === "none" && noSell > 0) {
      warnings.push(`Catalogues are not changed, so products stay published in ${noSell} market${noSell === 1 ? "" : "s"} where checkout is blocked.`);
    }
  }
  return { target, mode, lines, unchanged, perMarket, totals, blocker, warnings };
}
