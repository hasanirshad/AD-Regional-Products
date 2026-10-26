import { describe, expect, it } from "vitest";
import { NONE } from "./filter";
import type { StockSummary } from "./inventory";
import { activeInvChips, applyBaseFilters, applyStockFilters, availabilityOf, countValues, NO_INV_FILTERS, stockNeeded, trackingOf, type InvFilters } from "./inventoryFilter";
import { product } from "./testkit";

const f = (over: Partial<InvFilters>): InvFilters => ({ ...NO_INV_FILTERS, ...over });
const rows = [
  { ...product("a"), vendor: "Hardman", productType: "Table", tags: ["new_stock", "oak"], variantCount: 1 },
  { ...product("b", ["c1"]), vendor: "Other", productType: "Bench", tags: ["oak"], variantCount: 6 },
  { ...product("c", ["c1", "c2"], "DRAFT"), vendor: "Hardman", productType: "Table", tags: [], variantCount: 8 },
];
const sum = (id: string, over: Partial<StockSummary>): StockSummary => ({ id, variants: 2, complete: true, tracked: 2, stops: 2, soldOut: 0, locations: [{ id: "L1", name: "London", available: 3, variants: 2 }], ...over });

describe("base filters", () => {
  it("search, several values per filter, and the product matches ANY chosen value", () => {
    expect(applyBaseFilters(rows, f({ search: "title b" })).map((p) => p.id)).toEqual(["b"]);
    expect(applyBaseFilters(rows, f({ vendor: ["Hardman"] })).map((p) => p.id)).toEqual(["a", "c"]);
    expect(applyBaseFilters(rows, f({ tag: ["new_stock", "oak"] })).map((p) => p.id)).toEqual(["a", "b"]);
    expect(applyBaseFilters(rows, f({ productType: ["Bench", "Table"] })).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(applyBaseFilters(rows, f({ status: ["DRAFT"] })).map((p) => p.id)).toEqual(["c"]);
  });
  it("catalogues, including none", () => {
    expect(applyBaseFilters(rows, f({ catalog: ["c2"] })).map((p) => p.id)).toEqual(["c"]);
    expect(applyBaseFilters(rows, f({ catalog: [NONE] })).map((p) => p.id)).toEqual(["a"]);
    expect(applyBaseFilters(rows, f({ catalog: [NONE, "c2"] })).map((p) => p.id)).toEqual(["a", "c"]);
  });
  it("number of variants, min and max (ignores anything that is not a number)", () => {
    expect(applyBaseFilters(rows, f({ min: "2" })).map((p) => p.id)).toEqual(["b", "c"]);
    expect(applyBaseFilters(rows, f({ max: "6" })).map((p) => p.id)).toEqual(["a", "b"]);
    expect(applyBaseFilters(rows, f({ min: "2", max: "6" })).map((p) => p.id)).toEqual(["b"]);
    expect(applyBaseFilters(rows, f({ min: "x" })).length).toBe(3);
  });
});

describe("stock filters", () => {
  const summaries = {
    a: sum("a", {}),
    b: sum("b", { soldOut: 2, locations: [{ id: "L2", name: "Berlin", available: 0, variants: 2 }] }),
    c: sum("c", { tracked: 0, soldOut: 1, locations: [] }),
  };
  it("classifies a summary", () => {
    expect(availabilityOf(summaries.a)).toBe("available");
    expect(availabilityOf(summaries.b)).toBe("soldout");
    expect(availabilityOf(summaries.c)).toBe("partly");
    expect(trackingOf(summaries.a)).toBe("all");
    expect(trackingOf(summaries.c)).toBe("none");
    expect(trackingOf(sum("x", { tracked: 1 }))).toBe("some");
  });
  it("does nothing when no stock filter is set", () => {
    expect(stockNeeded(NO_INV_FILTERS)).toBe(false);
    expect(applyStockFilters(rows, NO_INV_FILTERS, {})).toEqual({ rows, waiting: 0 });
  });
  it("filters by availability, tracking and location (any chosen value)", () => {
    expect(applyStockFilters(rows, f({ availability: ["soldout"] }), summaries).rows.map((p) => p.id)).toEqual(["b"]);
    expect(applyStockFilters(rows, f({ availability: ["soldout", "partly"] }), summaries).rows.map((p) => p.id)).toEqual(["b", "c"]);
    expect(applyStockFilters(rows, f({ tracked: ["none"] }), summaries).rows.map((p) => p.id)).toEqual(["c"]);
    expect(applyStockFilters(rows, f({ locations: ["L1", "L2"] }), summaries).rows.map((p) => p.id)).toEqual(["a", "b"]);
    expect(applyStockFilters(rows, f({ locations: [NONE] }), summaries).rows.map((p) => p.id)).toEqual(["c"]);
  });
  it("leaves out products not read yet and counts them", () => {
    const r = applyStockFilters(rows, f({ availability: ["available"] }), { a: summaries.a });
    expect(r.rows.map((p) => p.id)).toEqual(["a"]);
    expect(r.waiting).toBe(2);
  });
});

describe("counts and chips", () => {
  it("counts products per value", () => {
    const c = countValues(rows);
    expect(c.tag.get("oak")).toBe(2);
    expect(c.vendor.get("Hardman")).toBe(2);
    expect(c.catalog.get("c1")).toBe(2);
  });
  it("one removable chip per value", () => {
    const filters = f({ tag: ["oak", "new_stock"], catalog: ["c1"], min: "2", locations: ["L1"], availability: ["soldout"] });
    const chips = activeInvChips(filters, { catalogs: { c1: "UK" }, locations: { L1: "London" } });
    expect(chips.map((c) => c.label)).toEqual(["Tag: oak", "Tag: new_stock", "Catalogue: UK", "Variants: 2 or more", "Sold out", "Stocked at London"]);
    expect(chips[0]!.remove(filters).tag).toEqual(["new_stock"]);
    expect(chips[3]!.remove(filters).min).toBe("");
  });
});
