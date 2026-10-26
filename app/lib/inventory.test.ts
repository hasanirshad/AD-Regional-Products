// The inventory flow against a small fake of Shopify (real code, fake network).
import { beforeEach, describe, expect, it, vi } from "vitest";

type V = { id: string; title: string; item: string; tracked: boolean; policy: string; qty: Record<string, number | null> };
const store: { products: Record<string, V[]>; ignore: boolean; failFor: string | null; calls: string[]; many: Set<string> } = {
  products: {},
  ignore: false,
  failFor: null,
  calls: [],
  many: new Set(),
};

vi.mock("./admin", async (orig) => {
  const real = await orig<typeof import("./admin")>();
  return {
    ...real,
    adminGraphql: vi.fn(async (query: string, vars: Record<string, any>) => {
      if (query.includes("InventoryStock")) {
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const vs = store.products[id];
            if (!vs) return null;
            return {
              id,
              status: "ACTIVE",
              variants: {
                pageInfo: { hasNextPage: store.many.has(id) && vars.first < 250 },
                nodes: vs.map((v) => ({
                  id: v.id,
                  title: v.title,
                  sku: "",
                  inventoryPolicy: v.policy,
                  inventoryItem: {
                    id: v.item,
                    tracked: v.tracked,
                    ...Object.fromEntries(
                      [0, 1, 2].filter((i) => vars[`loc${i}`]).map((i) => {
                        const q = v.qty[vars[`loc${i}`]];
                        return [`l${i}`, q === null || q === undefined ? null : { quantities: [{ name: "available", quantity: q }] }];
                      }),
                    ),
                  },
                })),
              },
            };
          }),
        };
      }
      if (query.includes("productVariantsBulkUpdate")) {
        store.calls.push(`variants:${vars.productId}:${JSON.stringify(vars.variants)}`);
        if (store.failFor === vars.productId) return { productVariantsBulkUpdate: { userErrors: [{ message: "nope" }] } };
        if (!store.ignore) {
          for (const e of vars.variants as any[]) {
            const v = store.products[vars.productId]!.find((x) => x.id === e.id)!;
            if (e.inventoryPolicy) v.policy = e.inventoryPolicy;
            if (e.inventoryItem?.tracked) v.tracked = true;
          }
        }
        return { productVariantsBulkUpdate: { userErrors: [] } };
      }
      if (query.includes("inventorySetQuantities")) {
        store.calls.push(`qty:${JSON.stringify(vars.input.quantities.map((q: any) => [q.inventoryItemId, q.quantity]))}`);
        if (!store.ignore) {
          for (const q of vars.input.quantities as any[]) {
            for (const list of Object.values(store.products)) for (const v of list) if (v.item === q.inventoryItemId) v.qty[q.locationId] = q.quantity;
          }
        }
        return { inventorySetQuantities: { userErrors: [] } };
      }
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    }),
  };
});

import { findStockDrift, findStockMismatch, planStock, readStock, recheckStock, runStock, settingsProblem, stockEngine, stockQuery, type StockSettings } from "./inventory";
import { product } from "./testkit";

const LOC1 = { id: "loc1", name: "Warehouse" };
const LOC2 = { id: "loc2", name: "New York" };
const settings: StockSettings = { track: true, stopAtZero: true, setQuantity: true, quantity: 1, locations: [LOC1] };
const both: StockSettings = { ...settings, locations: [LOC1, LOC2] };
const hooks = { onProgress: () => {}, shouldStop: () => false, retryWaitMs: 0 };
const v = (id: string, over: Partial<V> = {}): V => ({ id: `v${id}`, title: `Var ${id}`, item: `i${id}`, tracked: false, policy: "CONTINUE", qty: { loc1: 0, loc2: 0 }, ...over });

async function plan(ids: string[], s: StockSettings = settings) {
  return planStock({ products: ids.map((id) => product(id)), states: await readStock(ids, s.locations.map((l) => l.id)), settings: s });
}

beforeEach(() => {
  store.products = {
    p1: [v("1"), v("2", { tracked: true, policy: "DENY", qty: { loc1: 1, loc2: 0 } })],
    p2: [v("3", { qty: { loc1: 5, loc2: 2 } })],
    p3: [v("4", { tracked: true, policy: "DENY", qty: { loc1: 1, loc2: 1 } })],
  };
  store.ignore = false;
  store.failFor = null;
  store.calls = [];
  store.many = new Set();
});

describe("settingsProblem", () => {
  it("needs a change, a whole quantity and a location", () => {
    expect(settingsProblem({ ...settings, track: false, stopAtZero: false, setQuantity: false })).toMatch(/at least one/);
    expect(settingsProblem({ ...settings, quantity: 1.5 })).toMatch(/whole number/);
    expect(settingsProblem({ ...settings, quantity: -1 })).toMatch(/whole number/);
    expect(settingsProblem({ ...settings, locations: [] })).toMatch(/location/);
    expect(settingsProblem(settings)).toBeNull();
  });
});

describe("planStock", () => {
  it("changes only what differs, and leaves matching products alone", async () => {
    const p = await plan(["p1", "p2", "p3"]);
    expect(p.lines.map((l) => l.product.id)).toEqual(["p1", "p2"]);
    expect(p.unchanged.map((x) => x.id)).toEqual(["p3"]);
    const l1 = p.lines[0]!;
    expect(l1.changes).toHaveLength(1);
    expect(l1.changes[0]).toMatchObject({ track: true, policy: true, setAt: ["loc1"] });
    expect(p.totals).toMatchObject({ track: 2, policy: 2, quantity: 2, lowered: 1 });
    expect(p.warnings.join(" ")).toMatch(/1 stock level is currently higher than 1/);
  });
  it("only touches the options that are switched on", async () => {
    const p = await plan(["p1"], { ...settings, stopAtZero: false, setQuantity: false });
    expect(p.lines[0]!.changes[0]).toMatchObject({ track: true, policy: false, setAt: [] });
  });
  it("does not set a quantity where the variant is not stocked at the location", async () => {
    store.products.p1![0]!.qty = { loc1: null, loc2: 0 };
    const p = await plan(["p1"]);
    expect(p.lines[0]!.changes[0]).toMatchObject({ track: true, policy: true, setAt: [] });
    expect(p.totals.notStocked).toBe(1);
    expect(p.warnings.join(" ")).toMatch(/not stocked/);
  });
  it("leaves out missing products and ones with too many variants", async () => {
    store.many.add("p2");
    const p = await plan(["p2", "gone"]);
    // p2 is read again on its own with a bigger page, so it is fine; gone is missing
    expect(p.lines.map((l) => l.product.id)).toEqual(["p2"]);
    expect(p.skipped.map((s) => s.product.id)).toEqual(["gone"]);
  });
  it("carries the blocker", async () => {
    expect((await plan(["p1"], { ...settings, quantity: -3 })).blocker).toMatch(/whole number/);
  });
});

describe("drift and mismatch", () => {
  it("spots a change made after the review", async () => {
    const p = await plan(["p1"]);
    expect(await recheckStock(p.lines, settings)).toEqual([]);
    store.products.p1![0]!.qty.loc1 = 7;
    expect((await recheckStock(p.lines, settings))[0]!.message).toMatch(/changed since the review/);
    delete store.products.p1;
    expect((await recheckStock(p.lines, settings))[0]!.message).toMatch(/not found/);
  });
  it("mismatch lists what Shopify did not take", async () => {
    const p = await plan(["p1"]);
    const state = await readStock(["p1"], ["loc1"]);
    const m = findStockMismatch(p.lines, settings, state);
    expect(m.map((x) => x.message).join(" ")).toMatch(/not tracked/);
    expect(findStockDrift(p.lines, state)).toEqual([]);
  });
});

describe("runStock", () => {
  it("tracks first, then sets the quantity, then reads back", async () => {
    const p = await plan(["p1", "p2"]);
    const { rows } = await runStock(settings, p.lines, hooks);
    expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
    expect(store.calls[0]).toMatch(/^variants:p1:/);
    expect(store.calls[0]).toContain('"inventoryItem":{"tracked":true}');
    expect(store.calls[0]).toContain('"inventoryPolicy":"DENY"');
    expect(store.calls[1]).toMatch(/^qty:/);
    expect(store.products.p1![0]).toMatchObject({ tracked: true, policy: "DENY", qty: { loc1: 1 } });
    expect(store.products.p2![0]).toMatchObject({ tracked: true, policy: "DENY", qty: { loc1: 1, loc2: 2 } });
    expect(rows[1]!.before).toBe("tracked 0/1 · stops at 0: 0/1 · stock: Warehouse 5");
    expect(rows[1]!.after).toBe("tracked 1/1 · stops at 0: 1/1 · stock: Warehouse 1");
  });
  it("reports a failure on one product and carries on", async () => {
    store.failFor = "p1";
    const p = await plan(["p1", "p2"]);
    const { rows } = await runStock(settings, p.lines, hooks);
    expect(rows.map((r) => r.status)).toEqual(["failed", "done"]);
    expect(rows[0]!.message).toMatch(/nope/);
  });
  it("says 'not verified' when Shopify did not take the change", async () => {
    store.ignore = true;
    const p = await plan(["p1"]);
    const { rows } = await runStock(settings, p.lines, hooks);
    expect(rows[0]!.status).toBe("not verified");
    expect(rows[0]!.message).toMatch(/not tracked/);
  });
  it("stops when asked", async () => {
    const p = await plan(["p1", "p2"]);
    const { rows } = await runStock(settings, p.lines, { ...hooks, shouldStop: () => true });
    expect(rows.map((r) => r.status)).toEqual(["not applied", "not applied"]);
    expect(store.calls).toEqual([]);
  });
  it("the engine rechecks and runs the same lines", async () => {
    const p = await plan(["p1"]);
    const e = stockEngine(p);
    expect(await e.recheck(e.lines)).toEqual([]);
    expect((await e.run(e.lines, hooks)).rows[0]!.status).toBe("done");
    expect(e.describe(e.lines[0]!)).toMatchObject({ productId: "p1" });
  });
});

describe("several locations", () => {
  it("builds one aliased level per location", () => {
    const q = stockQuery(2);
    expect(q).toContain("$loc0: ID!");
    expect(q).toContain("$loc1: ID!");
    expect(q).toContain("l1: inventoryLevel(locationId: $loc1)");
    expect(stockQuery(0)).not.toContain("inventoryLevel");
  });
  it("sets the quantity at every ticked location and leaves the others alone", async () => {
    store.products.p1![0]!.qty = { loc1: 4, loc2: 1 };
    store.products.p2![0]!.qty = { loc1: 5, loc2: 2 };
    const p = await plan(["p1", "p2"], both);
    expect(p.lines[0]!.changes[0]!.setAt).toEqual(["loc1"]); // loc2 already 1
    expect(p.lines[1]!.changes[0]!.setAt).toEqual(["loc1", "loc2"]);
    expect(p.totals.quantity).toBe(4);
    const { rows } = await runStock(both, p.lines, hooks);
    expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
    expect(store.products.p2![0]!.qty).toEqual({ loc1: 1, loc2: 1 });
  });
  it("one location only: the other is not read or changed", async () => {
    const p = await plan(["p2"], settings);
    await runStock(settings, p.lines, hooks);
    expect(store.products.p2![0]!.qty).toEqual({ loc1: 1, loc2: 2 });
  });
  it("reports a place that is not stocked", async () => {
    store.products.p3![0]!.qty = { loc1: 1, loc2: null };
    const p = await plan(["p3"], both);
    expect(p.totals.notStocked).toBe(1);
    expect(p.lines).toHaveLength(0);
  });
});
