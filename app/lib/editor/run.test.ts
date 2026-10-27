import { describe, expect, it } from "vitest";
import { editorEngine, recheckBundles, runBundles } from "./run";
import { baseOf } from "./doc";
import { fakeProduct, fakeVariant, FakeShopify, LOC_A } from "./fake";
import { loadProductDoc } from "./load";
import { targetKey, type Bundle, type Change, type Target, type Value } from "./model";
import type { ProductDoc } from "./doc";
import { tagsToValue } from "./canon";

const hooks = () => {
  const stages: string[] = [];
  const progress: { done: number; total: number }[] = [];
  return {
    stages,
    progress,
    hooks: { onProgress: (p: { done: number; total: number }) => progress.push({ done: p.done, total: p.total }), shouldStop: () => false, onStage: (s: string) => stages.push(s), retryWaitMs: 0 } as never,
  };
};

const pid = (n: number) => `gid://shopify/Product/${n}`;
const vid = (n: number) => `gid://shopify/ProductVariant/${n}1`;

const mk = (doc: ProductDoc, target: Target, after: Value, label = "Field"): Change => ({
  id: targetKey(target),
  target,
  productId: doc.id,
  productTitle: doc.title,
  label,
  tab: "basic",
  before: baseOf(doc, target),
  after,
});

async function twoProducts() {
  const shop = new FakeShopify([fakeProduct(pid(1), { title: "One", variants: [fakeVariant(vid(1))] }), fakeProduct(pid(2), { title: "Two", variants: [fakeVariant(vid(2))] })]);
  const docs = [await loadProductDoc(shop.gql, pid(1), []), await loadProductDoc(shop.gql, pid(2), [])];
  const bundles: Bundle[] = docs.map((d) => ({
    productId: d.id,
    title: d.title,
    handle: d.handle,
    changes: [mk(d, { kind: "product", productId: d.id, field: "title" }, `${d.title} new`, "Title"), mk(d, { kind: "product", productId: d.id, field: "tags" }, tagsToValue(["oak", "sale"]), "Tags")],
  }));
  return { shop, bundles };
}

describe("recheckBundles", () => {
  it("finds nothing when the store still matches the review", async () => {
    const { shop, bundles } = await twoProducts();
    expect(await recheckBundles(shop.gql, bundles)).toEqual([]);
  });

  it("reports a product that changed in Shopify since it was loaded", async () => {
    const { shop, bundles } = await twoProducts();
    shop.products.get(pid(2))!.title = "Someone renamed it";
    const found = await recheckBundles(shop.gql, bundles);
    expect(found).toHaveLength(1);
    expect(found[0]!.productId).toBe(pid(2));
    expect(found[0]!.message).toContain("Title: changed in Shopify");
    expect(found[0]!.message).toContain("Someone renamed it");
  });

  it("reports a product that was deleted", async () => {
    const { shop, bundles } = await twoProducts();
    shop.products.delete(pid(1));
    const found = await recheckBundles(shop.gql, bundles);
    expect(found[0]!.message).toContain("no longer found");
  });

  it("does not call a different tag spelling or order a change", async () => {
    const { shop, bundles } = await twoProducts();
    shop.products.get(pid(1))!.tags = ["OAK"];
    expect(await recheckBundles(shop.gql, [bundles[0]!])).toEqual([]);
  });
});

describe("runBundles", () => {
  it("applies, reads back and reports one row per change", async () => {
    const { shop, bundles } = await twoProducts();
    const h = hooks();
    const { rows, applied } = await runBundles(shop.gql, bundles, h.hooks);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "done")).toBe(true);
    expect(applied).toHaveLength(4);
    expect(shop.products.get(pid(1))!.title).toBe("One new");
    expect(shop.products.get(pid(2))!.tags).toEqual(["oak", "sale"]);
    expect(h.stages).toEqual(["applying", "verifying"]);
    expect(h.progress.at(-1)).toEqual({ done: 2, total: 2 });
    const tagRow = rows.find((r) => r.title.endsWith("Tags"))!;
    expect(tagRow.added).toEqual(["sale"]);
  });

  it("marks a change 'not verified' when Shopify says ok but keeps the old value", async () => {
    const { shop, bundles } = await twoProducts();
    shop.ignore.add("EditorProductUpdate");
    const { rows } = await runBundles(shop.gql, bundles, hooks().hooks);
    expect(rows.every((r) => r.status === "not verified")).toBe(true);
    expect(rows[0]!.message).toContain("still shows a different value");
  });

  it("keeps going when one product fails, and reports it", async () => {
    const { shop, bundles } = await twoProducts();
    const real = shop.gql;
    const gql = (async (q: string, v: Record<string, unknown>) => {
      if (q.includes("EditorProductUpdate") && (v.product as { id: string }).id === pid(1)) throw new Error("Shopify did not answer");
      return real(q, v);
    }) as typeof real;
    const { rows } = await runBundles(gql, bundles, hooks().hooks);
    expect(rows.filter((r) => r.productId === pid(1)).every((r) => r.status === "failed")).toBe(true);
    expect(rows.filter((r) => r.productId === pid(2)).every((r) => r.status === "done")).toBe(true);
  });

  it("does not start a product after Stop, and says so", async () => {
    const { shop, bundles } = await twoProducts();
    let calls = 0;
    const h = { onProgress: () => {}, shouldStop: () => calls++ >= 1, retryWaitMs: 0 } as never;
    const { rows } = await runBundles(shop.gql, bundles, h);
    const statuses = new Set(rows.map((r) => r.status));
    expect(statuses.has("done")).toBe(true);
    expect(rows.filter((r) => r.status === "not applied").length).toBeGreaterThan(0);
    expect(shop.products.get(pid(2))!.title).toBe("Two");
  });

  it("reports a read-back failure as not verified, not as failed", async () => {
    const { shop, bundles } = await twoProducts();
    const real = shop.gql;
    const gql = (async (q: string, v: Record<string, unknown>) => {
      if (q.includes("ReadProductFields")) throw new Error("timeout");
      return real(q, v);
    }) as typeof real;
    const { rows } = await runBundles(gql, bundles, hooks().hooks);
    expect(rows.every((r) => r.status === "not verified")).toBe(true);
    expect(rows[0]!.message).toContain("Could not read it back");
  });
});

describe("editorEngine", () => {
  it("passes the run summary to afterRun, and survives afterRun failing", async () => {
    const { shop, bundles } = await twoProducts();
    const seen: number[] = [];
    const engine = editorEngine({
      gql: shop.gql,
      bundles,
      afterRun: (s) => {
        seen.push(s.applied.length);
        throw new Error("could not save undo");
      },
    });
    const out = await engine.run(engine.lines, hooks().hooks);
    expect(seen).toEqual([4]);
    expect(out.rows).toHaveLength(4);
    expect(engine.describe(bundles[0]!)).toEqual({ productId: pid(1), title: "One", handle: "product-gid://shopify/Product/1" });
  });
});
