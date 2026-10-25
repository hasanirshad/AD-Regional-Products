// Storefront links for a product in every market, on the live theme or a preview theme. Pure functions, no Shopify calls.

import { isPublishedIn } from "./overview";
import { csvCell } from "./report";
import type { Market, ProductRow } from "./types";

/** One web presence of a market (its domain or subfolder). */
export type WebPresence = {
  domain: string | null;
  subfolder: string | null;
  defaultLocale: string;
  rootUrls: { locale: string; url: string }[];
};

export type Theme = { id: string; numericId: string; name: string; role: string };

export type MarketRoot = {
  /** The storefront address of the market, no trailing slash. */
  root: string;
  /** Where it came from: the market's own domain, a subfolder of another domain, or the store's primary domain (market has no web presence). */
  source: "domain" | "subfolder" | "primary";
};

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** The market's primary address: its own domain first, then a subfolder, then the store's primary domain. */
export function pickRoot(presences: WebPresence[], primaryUrl: string): MarketRoot {
  const rootOf = (p: WebPresence): string | null => {
    const hit = p.rootUrls.find((r) => r.locale === p.defaultLocale) ?? p.rootUrls[0];
    if (hit?.url) return trimSlash(hit.url);
    if (p.domain) return `https://${p.domain}`;
    return null;
  };
  for (const p of presences) {
    const root = p.domain ? rootOf(p) : null;
    if (root) return { root, source: "domain" };
  }
  for (const p of presences) {
    const root = p.subfolder ? rootOf(p) : null;
    if (root) return { root, source: "subfolder" };
  }
  return { root: trimSlash(primaryUrl), source: "primary" };
}

/** US visitors from elsewhere get redirected away from the US storefront unless this is set. */
export const STAY_PARAM = { name: "stay_us", value: "1" } as const;

export function isUsMarket(market: Pick<Market, "countries">): boolean {
  return market.countries.some((c) => c.code === "US");
}

/** The theme to preview: "" = the live theme (no parameter). */
export function productUrl(input: { root: string; handle: string; themeId: string; stayUs: boolean }): string {
  const params: string[] = [];
  if (input.themeId) params.push(`preview_theme_id=${encodeURIComponent(input.themeId)}`);
  if (input.stayUs) params.push(`${STAY_PARAM.name}=${STAY_PARAM.value}`);
  return `${trimSlash(input.root)}/products/${input.handle}${params.length ? `?${params.join("&")}` : ""}`;
}

/** admin.shopify.com address of a product. `myshopifyDomain` is e.g. "hardman.myshopify.com". */
export function adminUrl(myshopifyDomain: string, numericProductId: string): string {
  return `https://admin.shopify.com/store/${myshopifyDomain.replace(/\.myshopify\.com$/, "")}/products/${numericProductId}`;
}

export type ProductLinks = {
  product: ProductRow;
  admin: string;
  markets: { marketId: string; marketName: string; url: string; published: boolean }[];
};

export function buildLinks(input: {
  products: ProductRow[];
  markets: Market[];
  roots: Record<string, MarketRoot>;
  /** "" = live theme. */
  themeId: string;
  myshopifyDomain: string;
}): ProductLinks[] {
  return input.products.map((product) => ({
    product,
    admin: adminUrl(input.myshopifyDomain, product.numericId),
    markets: input.markets.flatMap((m) => {
      const root = input.roots[m.id];
      if (!root) return [];
      return [
        {
          marketId: m.id,
          marketName: m.name,
          url: productUrl({ root: root.root, handle: product.handle, themeId: input.themeId, stayUs: isUsMarket(m) }),
          published: isPublishedIn(product, m),
        },
      ];
    }),
  }));
}

/** One row per product per market: title, market, store link, admin link (and whether it is published there). */
export function linksCsv(rows: ProductLinks[]): string {
  const lines = [["Product", "Market", "Store link", "Admin link", "Published in market"].map(csvCell).join(",")];
  for (const r of rows) {
    for (const m of r.markets) {
      lines.push([r.product.title, m.marketName, m.url, r.admin, m.published ? "yes" : "no"].map(csvCell).join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

export const themeLabel = (t: Theme) => `${t.name}${t.role === "MAIN" ? " (live)" : t.role === "DEMO" ? " (demo)" : t.role === "DEVELOPMENT" ? " (development)" : ""}`;
