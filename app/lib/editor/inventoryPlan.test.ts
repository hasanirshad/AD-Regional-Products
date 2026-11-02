import { describe, expect, it } from "vitest";
import type { VariantDoc } from "./doc";
import { capValue, defaultLocation, fold, modeOf, planCap, planCapForAll, planStockMode, saleRunning } from "./inventoryPlan";
import { targetKey } from "./model";

const P = "p1";
const v = (id: string, extra: Partial<VariantDoc> = {}): VariantDoc => ({
  id, title: id, position: 1, options: [], price: "0.00", compareAtPrice: null, sku: null, barcode: null, policy: "DENY", tracked: false, itemId: `i-${id}`, levels: [], metafields: {}, ...extra,
});
const keys = (edits: { target: Parameters<typeof targetKey>[0] }[]) => edits.map((e) => targetKey(e.target));

describe("default location", () => {
  const locs = [{ id: "L1", name: "Lahore warehouse" }, { id: "L2", name: "Hardman Möbel Ltd. | London" }, { id: "L3", name: "Hardman Berlin" }];
  it("finds the London location by its name, ignoring accents and case", () => {
    expect(defaultLocation(locs)!.id).toBe("L2");
    expect(defaultLocation([{ id: "x", name: "HARDMAN MOBEL LTD |LONDON" }])!.id).toBe("x");
  });
  it("accepts a single other location with London in the name, but never guesses between two", () => {
    expect(defaultLocation([{ id: "a", name: "London showroom" }, { id: "b", name: "Berlin" }])!.id).toBe("a");
    expect(defaultLocation([{ id: "a", name: "London showroom" }, { id: "b", name: "London store" }])).toBeNull();
    expect(defaultLocation([{ id: "a", name: "Berlin" }])).toBeNull();
  });
  it("folds names", () => expect(fold("Hardman Möbel Ltd. | London")).toBe("hardman mobel ltd | london"));
});

describe("modeOf", () => {
  it("tells stock, made to order and mixed apart", () => {
    expect(modeOf([{ tracked: true }, { tracked: true }])).toBe("stock");
    expect(modeOf([{ tracked: false }])).toBe("made_to_order");
    expect(modeOf([{ tracked: true }, { tracked: false }])).toBe("mixed");
    expect(modeOf([])).toBe("made_to_order");
  });
});

describe("planStockMode", () => {
  it("made to order: untracked, and a new variant gets the default location at 0", () => {
    const { edits } = planStockMode(P, [v("a")], "made_to_order", "L2");
    expect(edits.map((e) => [targetKey(e.target), e.value])).toEqual([["v|a|tracked", "false"], ["s|a|L2", "0"]]);
  });
  it("stock: tracked, and a variant with no units gets 1 at the default location", () => {
    const { edits } = planStockMode(P, [v("a"), v("b")], "stock", "L2");
    expect(edits.map((e) => [targetKey(e.target), e.value])).toEqual([["v|a|tracked", "true"], ["s|a|L2", "1"], ["v|b|tracked", "true"], ["s|b|L2", "1"]]);
  });
  it("stock: keeps quantities that exist, and fills 1 at the main location when there are none", () => {
    const has = v("a", { levels: [{ locationId: "L1", quantity: 4 }] });
    const empty = v("b", { levels: [{ locationId: "L1", quantity: 0 }, { locationId: "L2", quantity: 0 }] });
    const { edits } = planStockMode(P, [has, empty], "stock", "L2");
    expect(keys(edits)).toEqual(["v|a|tracked", "v|b|tracked", "s|b|L2"]);
    expect(edits.at(-1)!.value).toBe("1");
  });
  it("never removes a location when switching", () => {
    const withTwo = v("a", { tracked: true, levels: [{ locationId: "L1", quantity: 2 }, { locationId: "L2", quantity: 3 }] });
    const { edits } = planStockMode(P, [withTwo], "made_to_order", "L2");
    expect(edits.every((e) => e.value !== null)).toBe(true);
    expect(keys(edits)).toEqual(["v|a|tracked"]);
  });
  it("asks for a location when there is no default and the variant has none", () => {
    const { edits, notes } = planStockMode(P, [v("a")], "stock", null);
    expect(keys(edits)).toEqual(["v|a|tracked"]);
    expect(notes[0]).toMatch(/Choose a location/);
  });
});

describe("CAP and price", () => {
  it("parses a typed CAP", () => {
    expect(capValue("1,299.5")).toEqual({ value: null, bad: true }); // a thousands separator is not guessed
    expect(capValue("1299,5")).toEqual({ value: "1299.50", bad: false });
    expect(capValue("  ")).toEqual({ value: null, bad: false });
    expect(capValue("abc").bad).toBe(true);
    expect(capValue("-5").bad).toBe(true);
  });
  it("the price follows the CAP", () => {
    const p = planCap(P, v("a"), "999");
    expect(p.edits.map((e) => [targetKey(e.target), e.value])).toEqual([["v|a|compareAtPrice", "999.00"], ["v|a|price", "999.00"]]);
    expect(p.note).toBeNull();
  });
  it("leaves a running sale price alone and says so", () => {
    const onSale = v("a", { price: "80.00", compareAtPrice: "100.00" });
    expect(saleRunning(onSale)).toBe(true);
    const p = planCap(P, onSale, "120");
    expect(keys(p.edits)).toEqual(["v|a|compareAtPrice"]);
    expect(p.note).toMatch(/sale is running/);
  });
  it("clearing the CAP clears only the CAP", () => {
    const p = planCap(P, v("a", { price: "50.00", compareAtPrice: "50.00" }), "");
    expect(p.edits.map((e) => [targetKey(e.target), e.value])).toEqual([["v|a|compareAtPrice", null]]);
  });
  it("an invalid CAP plans nothing", () => expect(planCap(P, v("a"), "x")).toEqual({ edits: [], note: null, bad: true }));
  it("one CAP for all variants, collecting the notes", () => {
    const r = planCapForAll(P, [v("a"), v("b", { price: "5.00", compareAtPrice: "9.00" })], "20");
    expect(keys(r.edits)).toEqual(["v|a|compareAtPrice", "v|a|price", "v|b|compareAtPrice"]);
    expect(r.notes).toHaveLength(1);
    expect(planCapForAll(P, [v("a")], "x").bad).toBe(true);
  });
});
