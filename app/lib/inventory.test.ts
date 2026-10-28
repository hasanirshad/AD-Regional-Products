// The inventory flow against a small fake of Shopify (real code, fake network).
import { beforeEach, describe, expect, it, vi } from "vitest";

type V = { id: string; title: string; item: string; tracked: boolean; policy: string; qty: Record<string, number | null> };
const NAMES: Record<string, string> = { loc1: "Warehouse", loc2: "New York", loc3: "Berlin" };
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
                pageInfo: { hasNextPage: store.many.has(id) && vars.first < 50 },
                nodes: vs.map((v) => ({
                  id: v.id,
                  title: v.title,
                  sku: "",
                  inventoryPolicy: v.policy,
                  inventoryItem: {
                    id: v.item,
                    tracked: v.tracked,
                    inventoryLevels: {
                      pageInfo: { hasNextPage: false },
                      nodes: Object.entries(v.qty)
                        .filter(([, q]) => q !== null && q !== undefined)
                        .map(([loc, q]) => ({
                          id: `lvl-${v.item}-${loc}`,
                          location: { id: loc, name: NAMES[loc] ?? loc },
                          quantities: [{ name: "available", quantity: q as number }],
                        })),
                    },
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
        // API 2026-04+: changeFromQuantity is mandatory (null opts out); compareQuantity and ignoreCompareQuantity are gone.
        for (const q of vars.input.quantities as any[]) {
          if (!("changeFromQuantity" in q) || q.changeFromQuantity === undefined) throw new Error("changeFromQuantity is missing");
        }
        if ("ignoreCompareQuantity" in vars.input || vars.input.quantities.some((q: any) => "compareQuantity" in q)) throw new Error("removed field sent");
        store.calls.push(`qty:${JSON.stringify(vars.input.quantities.map((q: any) => [q.inventoryItemId, q.quantity]))}`);
        if (!store.ignore) {
          for (const q of vars.input.quantities as any[]) {
            for (const list of Object.values(store.products)) for (const v of list) if (v.item === q.inventoryItemId) v.qty[q.locationId] = q.quantity;
          }
        }
        return { inventorySetQuantities: { userErrors: [] } };
      }
      if (query.includes("inventoryDeactivate")) {
        store.calls.push(`deactivate:${vars.id}`);
        if (store.failFor === "deactivate") return { inventoryDeactivate: { userErrors: [{ message: "has committed stock" }] } };
        if (!store.ignore) {
          for (const list of Object.values(store.products)) for (const v of list) for (const loc of Object.keys(v.qty)) if (vars.id === `lvl-${v.item}-${loc}`) v.qty[loc] = null;
        }
        return { inventoryDeactivate: { userErrors: [] } };
      }
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    }),
  };
});

import { findStockDrift, findStockMismatch, planStock, readStock, recheckStock, runStock, settingsProblem, stockEngine, summarizeStock, type StockSettings } from "./inventory";
import { product } from "./testkit";

const LOC1 = { id: "loc1", name: "Warehouse" };
const LOC2 = { id: "loc2", name: "New York" };
const settings: StockSettings = { track: true, stopAtZero: true, setQuantity: true, quantity: 1, locations: [LOC1], onlyHere: false };
const both: StockSettings = { ...settings, locations: [LOC1, LOC2] };
const hooks = { onProgress: () => {}, shouldStop: () => false, retryWaitMs: 0 };
const v = (id: string, over: Partial<V> = {}): V => ({ id: `v${id}`, title: `Var ${id}`, item: `i${id}`, tracked: false, policy: "CONTINUE", qty: { loc1: 0, loc2: 0 }, ...over });

async function plan(ids: string[], s: StockSettings = settings) {
  return planStock({ products: ids.map((id) => product(id)), states: await readStock(ids), settings: s });
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
    const state = await readStock(["p1"]);
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
    expect(rows[1]!.before).toBe("tracked 0/1 · stops at 0: 0/1 · stock: New York 2 | Warehouse 5");
    expect(rows[1]!.after).toBe("tracked 1/1 · stops at 0: 1/1 · stock: New York 2 | Warehouse 1");
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

describe("summarizeStock", () => {
  const level = (id: string, name: string, q: number) => ({ location: { id, name }, quantities: [{ name: "available", quantity: q }] });
  it("adds up what is stocked at each location and counts tracked and stop-at-zero variants", () => {
    const s = summarizeStock({
      id: "p",
      variants: {
        pageInfo: { hasNextPage: false },
        nodes: [
          { inventoryPolicy: "DENY", inventoryItem: { tracked: true, inventoryLevels: { nodes: [level("l1", "London", 16), level("l2", "Berlin", 2)] } } },
          { inventoryPolicy: "CONTINUE", inventoryItem: { tracked: false, inventoryLevels: { nodes: [level("l1", "London", 4)] } } },
        ],
      },
    });
    expect(s).toMatchObject({ variants: 2, complete: true, tracked: 1, stops: 1, soldOut: 0 });
    expect(s.locations).toEqual([
      { id: "l2", name: "Berlin", available: 2, variants: 1 },
      { id: "l1", name: "London", available: 20, variants: 2 },
    ]);
  });
  it("counts a tracked variant that stops at 0 and has nothing left anywhere as sold out", () => {
    const mk = (policy: string, tracked: boolean, qs: number[]) => ({
      inventoryPolicy: policy,
      inventoryItem: { tracked, inventoryLevels: { nodes: qs.map((q, i) => level(`l${i}`, `L${i}`, q)) } },
    });
    const s = summarizeStock({
      id: "p",
      variants: {
        pageInfo: { hasNextPage: false },
        nodes: [mk("DENY", true, [0, 0]), mk("DENY", true, [0, 2]), mk("CONTINUE", true, [0]), mk("DENY", false, [0]), mk("DENY", true, [])],
      },
    });
    // 1st: sold out. 2nd: has 2. 3rd: keeps selling. 4th: not tracked. 5th: tracked, stops, stocked nowhere = sold out.
    expect(s.soldOut).toBe(2);
  });
  it("copes with a variant that has no inventory item and says when variants were cut off", () => {
    const s = summarizeStock({ id: "p", variants: { pageInfo: { hasNextPage: true }, nodes: [{ inventoryPolicy: "DENY", inventoryItem: null }] } });
    expect(s).toMatchObject({ variants: 1, complete: false, tracked: 0, stops: 1, soldOut: 0, locations: [] });
  });
});

describe("only these locations", () => {
  const only: StockSettings = { track: false, stopAtZero: false, setQuantity: false, quantity: 1, locations: [LOC1], onlyHere: true };
  beforeEach(() => {
    store.products = {
      p1: [v("1", { tracked: true, policy: "DENY", qty: { loc1: 1, loc2: 0, loc3: 0 } }), v("2", { tracked: true, policy: "DENY", qty: { loc1: 1, loc2: 3, loc3: null } })],
      p2: [v("3", { tracked: true, policy: "DENY", qty: { loc1: null, loc2: 2, loc3: 0 } })],
      p3: [v("4", { tracked: true, policy: "DENY", qty: { loc1: 1, loc2: null, loc3: null } })],
    };
  });
  it("needs a ticked location", () => {
    expect(settingsProblem({ ...only, locations: [] })).toMatch(/location/);
    expect(settingsProblem(only)).toBeNull();
  });
  it("plans to drop every other location, but not from a variant that is not stocked at the ticked one", async () => {
    const p = await plan(["p1", "p2", "p3"], only);
    expect(p.lines.map((l) => l.product.id)).toEqual(["p1"]);
    expect(p.lines[0]!.changes.map((c) => c.remove.map((r) => r.locationId))).toEqual([["loc2", "loc3"], ["loc2"]]);
    expect(p.unchanged.map((x) => x.id)).toEqual(["p2", "p3"]);
    expect(p.totals).toMatchObject({ remove: 3, removedStock: 1, keptAll: 1 });
    expect(p.warnings.join(" ")).toMatch(/still hold stock/);
    expect(p.warnings.join(" ")).toMatch(/must stay stocked somewhere/);
  });
  it("removes the other locations, keeps the ticked one, and reads back", async () => {
    const p = await plan(["p1"], only);
    const { rows } = await runStock(only, p.lines, hooks);
    expect(rows[0]!.status).toBe("done");
    expect(store.products.p1![0]!.qty).toEqual({ loc1: 1, loc2: null, loc3: null });
    expect(store.products.p1![1]!.qty).toEqual({ loc1: 1, loc2: null, loc3: null });
    expect(rows[0]!.after).toBe("tracked 2/2 · stops at 0: 2/2 · stock: Warehouse 1, 1");
    expect(rows[0]!.added.join(" ")).toMatch(/Remove other locations: 3/);
  });
  it("sets the quantity first, then removes", async () => {
    const s = { ...only, setQuantity: true, quantity: 2 };
    const p = await plan(["p1"], s);
    await runStock(s, p.lines, hooks);
    const iQty = store.calls.findIndex((c) => c.startsWith("qty:"));
    const iDeact = store.calls.findIndex((c) => c.startsWith("deactivate:"));
    expect(iQty).toBeGreaterThan(-1);
    expect(iDeact).toBeGreaterThan(iQty);
    expect(store.products.p1![0]!.qty).toEqual({ loc1: 2, loc2: null, loc3: null });
  });
  it("shows a failure when Shopify refuses to remove a location", async () => {
    store.failFor = "deactivate";
    const p = await plan(["p1"], only);
    const { rows } = await runStock(only, p.lines, hooks);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.message).toMatch(/committed/);
  });
  it("says 'not verified' when the location is still there", async () => {
    store.ignore = true;
    const p = await plan(["p1"], only);
    const { rows } = await runStock(only, p.lines, hooks);
    expect(rows[0]!.status).toBe("not verified");
    expect(rows[0]!.message).toMatch(/still stocked at/);
  });
  it("spots a stock level added after the review", async () => {
    const p = await plan(["p1"], only);
    store.products.p1![0]!.qty.loc3 = null;
    expect((await recheckStock(p.lines, only))[0]!.message).toMatch(/changed since the review/);
  });
});
