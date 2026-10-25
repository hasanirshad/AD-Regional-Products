import { describe, expect, it } from "vitest";
import { adminUrl, buildLinks, isUsMarket, linksCsv, pickRoot, productUrl, type WebPresence } from "./links";
import { market, product } from "./testkit";

const pres = (over: Partial<WebPresence> = {}): WebPresence => ({
  domain: null,
  subfolder: null,
  defaultLocale: "en",
  rootUrls: [],
  ...over,
});

describe("pickRoot", () => {
  it("uses the market's own domain, at its default language", () => {
    const r = pickRoot(
      [pres({ domain: "hardman.de", defaultLocale: "de", rootUrls: [{ locale: "en", url: "https://hardman.de/en" }, { locale: "de", url: "https://hardman.de" }] })],
      "https://hardman.com",
    );
    expect(r).toEqual({ root: "https://hardman.de", source: "domain" });
  });
  it("prefers a domain over a subfolder, and removes a trailing slash", () => {
    const r = pickRoot(
      [pres({ subfolder: "fr", rootUrls: [{ locale: "en", url: "https://hardman.com/fr" }] }), pres({ domain: "hardman.fr", rootUrls: [{ locale: "en", url: "https://hardman.fr/" }] })],
      "https://hardman.com",
    );
    expect(r).toEqual({ root: "https://hardman.fr", source: "domain" });
  });
  it("uses a subfolder when there is no domain", () => {
    expect(pickRoot([pres({ subfolder: "nl", rootUrls: [{ locale: "en", url: "https://hardman.com/nl" }] })], "https://hardman.com")).toEqual({ root: "https://hardman.com/nl", source: "subfolder" });
  });
  it("falls back to the host when root urls are missing, and to the primary domain when there is no web presence", () => {
    expect(pickRoot([pres({ domain: "hardman.ch" })], "https://x.com").root).toBe("https://hardman.ch");
    expect(pickRoot([], "https://hardman.com/")).toEqual({ root: "https://hardman.com", source: "primary" });
  });
});

describe("productUrl", () => {
  it("is plain for the live theme", () => {
    expect(productUrl({ root: "https://hardman.de/", handle: "oak-table", themeId: "", stayUs: false })).toBe("https://hardman.de/products/oak-table");
  });
  it("adds the preview theme id, and stay_us for the US", () => {
    expect(productUrl({ root: "https://hardman.com", handle: "t", themeId: "123", stayUs: false })).toBe("https://hardman.com/products/t?preview_theme_id=123");
    expect(productUrl({ root: "https://hardman.com", handle: "t", themeId: "123", stayUs: true })).toBe("https://hardman.com/products/t?preview_theme_id=123&stay_us=1");
    expect(productUrl({ root: "https://hardman.com", handle: "t", themeId: "", stayUs: true })).toBe("https://hardman.com/products/t?stay_us=1");
  });
  it("keeps a subfolder in front of /products", () => {
    expect(productUrl({ root: "https://hardman.com/fr", handle: "t", themeId: "", stayUs: false })).toBe("https://hardman.com/fr/products/t");
  });
});

describe("adminUrl and the US market", () => {
  it("builds the admin address from the myshopify domain", () => {
    expect(adminUrl("hardman.myshopify.com", "42")).toBe("https://admin.shopify.com/store/hardman/products/42");
  });
  it("a market with the United States is the US market", () => {
    expect(isUsMarket(market("US", ["US"]))).toBe(true);
    expect(isUsMarket(market("DE", ["DE"]))).toBe(false);
  });
});

describe("buildLinks and the export", () => {
  const us = market("US", ["US"], ["c-US"]);
  const de = market("DE", ["DE"], ["c-DE"]);
  const roots = { US: { root: "https://hardman.com", source: "domain" as const }, DE: { root: "https://hardman.de", source: "domain" as const } };
  const rows = buildLinks({ products: [product("1", ["c-US"])], markets: [us, de], roots, themeId: "99", myshopifyDomain: "hardman.myshopify.com" });
  it("gives each market its own link and says whether the product is published there", () => {
    expect(rows[0]!.markets.map((m) => [m.marketName, m.url, m.published])).toEqual([
      ["US", "https://hardman.com/products/handle-1?preview_theme_id=99&stay_us=1", true],
      ["DE", "https://hardman.de/products/handle-1?preview_theme_id=99", false],
    ]);
  });
  it("skips a market whose address is unknown", () => {
    expect(buildLinks({ products: [product("1")], markets: [us, de], roots: { DE: roots.DE }, themeId: "", myshopifyDomain: "h.myshopify.com" })[0]!.markets).toHaveLength(1);
  });
  it("exports one row per product and market: title, market, store link, admin link", () => {
    const lines = linksCsv(rows).trim().split("\r\n");
    expect(lines[0]).toBe("Product,Market,Store link,Admin link,Published in market");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("Title 1,US,https://hardman.com/products/handle-1?preview_theme_id=99&stay_us=1,https://admin.shopify.com/store/hardman/products/1,yes");
  });
});
