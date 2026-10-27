import { describe, expect, it } from "vitest";
import { fakeShopify, gqlError } from "../testkit/fake";
import { makeQueries } from "./graphql";
import { pricingSelection, readPricing, withPricing } from "./pricing";

const money = (amount: string, currencyCode: string) => ({ amount, currencyCode });
const quote = (p: string, c: string | null, cur: string) => ({ price: money(p, cur), compareAtPrice: c ? money(c, cur) : null });

describe("pricing", () => {
  it("builds one alias per country and refuses a bad code", () => {
    const sel = pricingSelection(["FR", "GB"]);
    expect(sel).toContain("p_FR: contextualPricing(context: { country: FR })");
    expect(sel).toContain("p_GB:");
    expect(() => pricingSelection(["fr"])).toThrow();
  });

  it("reads low and high prices out of a product", () => {
    const product = { p_FR: { minVariantPricing: quote("900", "1000", "EUR"), maxVariantPricing: quote("1500", null, "EUR") }, p_GB: null };
    const out = readPricing(product, ["FR", "GB", "US"]);
    expect(out.FR?.low.price?.amount).toBe(900);
    expect(out.FR?.low.compareAt?.amount).toBe(1000);
    expect(out.FR?.high.compareAt).toBeNull();
    expect(out.GB).toBeNull();
    expect(out.US).toBeNull();
  });

  it("uses the product-level answer when Shopify accepts it", async () => {
    const { raw } = fakeShopify({
      Main: () => ({ product: { id: "p1", p_FR: { minVariantPricing: quote("10", null, "EUR"), maxVariantPricing: quote("20", null, "EUR") } } }),
    });
    const { q } = makeQueries(raw, async () => {});
    const r = await withPricing(q, "p1", ["FR"], (sel) => q<{ product: Record<string, unknown> }>(`query Main { product { id ${sel} } }`));
    expect(r.pricing.prices.FR?.high.price?.amount).toBe(20);
    expect(r.pricing.note).toBeNull();
  });

  it("falls back to sampled variants when Shopify rejects contextualPricing on Product", async () => {
    const { raw, seen } = fakeShopify({
      Main: (_v, query) => {
        if (query.includes("contextualPricing")) return gqlError("Field 'contextualPricing' doesn't exist on type 'Product'", "undefinedField");
        return { product: { id: "p1" } };
      },
      SampledPricing: () => ({
        product: {
          variantsCount: { count: 80 },
          variants: { nodes: [{ p_FR: quote("300", "400", "EUR") }, { p_FR: quote("100", null, "EUR") }, { p_FR: quote("200", null, "EUR") }] },
        },
      }),
    });
    const { q } = makeQueries(raw, async () => {});
    const r = await withPricing(q, "p1", ["FR"], (sel) => q<{ product: Record<string, unknown> }>(`query Main { product { id ${sel} } }`));
    expect(r.pricing.prices.FR?.low.price?.amount).toBe(100);
    expect(r.pricing.prices.FR?.high.price?.amount).toBe(300);
    expect(r.pricing.prices.FR?.high.compareAt?.amount).toBe(400);
    expect(r.pricing.note).toMatch(/first 3 of 80 variants/);
    expect(seen.map((s) => s.name)).toEqual(["Main", "Main", "SampledPricing"]);
  });

  it("does not hide other errors behind the fallback", async () => {
    const { raw } = fakeShopify({ Main: () => gqlError("Access denied for products", "ACCESS_DENIED") });
    const { q } = makeQueries(raw, async () => {});
    await expect(withPricing(q, "p1", ["FR"], (sel) => q<{ product: unknown }>(`query Main { product { id ${sel} } }`))).rejects.toMatchObject({ kind: "access" });
  });
});
