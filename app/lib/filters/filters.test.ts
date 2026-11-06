import { describe, expect, it } from "vitest";
import type { StockSummary } from "../inventory";
import type { ProductRow } from "../types";
import { applyBase, applyFilters, stockCandidates, availabilityOf, trackingOf, type FilterContext } from "./applyFilters";
import { addValue, ANY, clearAll, countActive, countValues, describeChips, isFiltering, NO_FILTERS, NONE, SECTION_LABEL, SECTION_ORDER, type FilterState } from "./filterModel";
import { identityText, matchesSearch, rowText, searchWords } from "./searchText";
import { matchingSelected, onlySelectedNote, onlySelectedStays, selectMatching, visibleRows } from "./selection";

const row = (id: string, p: Partial<ProductRow> = {}): ProductRow => ({
  id: `gid://shopify/Product/${id}`,
  numericId: id,
  title: `Product ${id}`,
  handle: `product-${id}`,
  vendor: "Hardman Design",
  productType: "Table",
  status: "ACTIVE",
  tags: [],
  catalogs: [],
  variantCount: 1,
  ...p,
});
const f = (p: Partial<FilterState>): FilterState => ({ ...NO_FILTERS, ...p });
const ids = (rows: ProductRow[]) => rows.map((r) => r.numericId);

const rows = [
  row("1", { title: "Oak dining table", tags: ["sale", "oak"], status: "ACTIVE", vendor: "Hardman Design", productType: "Table", catalogs: [{ id: "c-uk", title: "UK" }], variantCount: 3 }),
  row("2", { title: "Walnut shelf", tags: ["new"], status: "DRAFT", vendor: "Other", productType: "Shelf", catalogs: [{ id: "c-uk", title: "UK" }, { id: "c-de", title: "DE" }] }),
  row("3", { title: "Oak chair", tags: ["oak", "chair"], status: "ARCHIVED", vendor: "Hardman Design", productType: "Chair", catalogs: [], variantCount: 6 }),
  row("4", { title: "Sale rug", tags: ["sale"], status: "ACTIVE", vendor: "Other", productType: "Rug", catalogs: [{ id: "c-de", title: "DE" }], variantCount: 2 }),
];

describe("sections", () => {
  it("keeps the standard order and labels", () => {
    expect(SECTION_ORDER.map((s) => SECTION_LABEL[s])).toEqual([
      "Status",
      "Vendor",
      "Product type",
      "Collection",
      "Tag, has",
      "Tag, does not have",
      "Market catalogue",
      "Published in market",
      "Stock",
      "Number of variants",
      "Price",
      "Translations",
      "Metafield",
      "This page only",
    ]);
  });
});

describe("AND across sections, any inside one", () => {
  it("returns everything with no filters", () => {
    expect(applyFilters(rows, NO_FILTERS).rows).toHaveLength(4);
  });
  it("any of the values in one section", () => {
    expect(ids(applyFilters(rows, f({ status: ["DRAFT", "ARCHIVED"] })).rows)).toEqual(["2", "3"]);
  });
  it("all sections must match", () => {
    expect(ids(applyFilters(rows, f({ status: ["ACTIVE"], vendor: ["Other"] })).rows)).toEqual(["4"]);
    expect(ids(applyFilters(rows, f({ status: ["ACTIVE"], vendor: ["Other"], productType: ["Table"] })).rows)).toEqual([]);
  });
  it("number of variants is a range", () => {
    expect(ids(applyFilters(rows, f({ min: "2", max: "3" })).rows)).toEqual(["1", "4"]);
    expect(ids(applyFilters(rows, f({ min: "4" })).rows)).toEqual(["3"]);
  });
  it("ignores a variants box that is not a whole number", () => {
    expect(applyFilters(rows, f({ min: "abc" })).rows).toHaveLength(4);
  });
});

describe("tags: has, any/all, does not have", () => {
  it("has: any of the chosen by default", () => {
    expect(ids(applyFilters(rows, f({ tag: ["sale", "new"] })).rows)).toEqual(["1", "2", "4"]);
  });
  it("has: all of the chosen", () => {
    expect(ids(applyFilters(rows, f({ tag: ["sale", "oak"], tagMatch: "all" })).rows)).toEqual(["1"]);
  });
  it("does not have works alone: none of the chosen", () => {
    expect(ids(applyFilters(rows, f({ tagNot: ["sale"] })).rows)).toEqual(["2", "3"]);
    expect(ids(applyFilters(rows, f({ tagNot: ["sale", "new"] })).rows)).toEqual(["3"]);
  });
  it("does not have together with has", () => {
    expect(ids(applyFilters(rows, f({ tag: ["oak"], tagNot: ["sale"] })).rows)).toEqual(["3"]);
    expect(ids(applyFilters(rows, f({ tag: ["sale"], tagNot: ["oak"] })).rows)).toEqual(["4"]);
  });
  it("a tag both wanted and excluded leaves nothing", () => {
    expect(applyFilters(rows, f({ tag: ["sale"], tagNot: ["sale"] })).rows).toEqual([]);
  });
  it("tag and does-not-have combine with the other sections", () => {
    expect(ids(applyFilters(rows, f({ tagNot: ["sale"], status: ["ARCHIVED"] })).rows)).toEqual(["3"]);
  });
});

describe("market catalogue in / not in", () => {
  it("in: any of the chosen catalogues", () => {
    expect(ids(applyFilters(rows, f({ catalogIn: ["c-uk"] })).rows)).toEqual(["1", "2"]);
    expect(ids(applyFilters(rows, f({ catalogIn: ["c-uk", "c-de"] })).rows)).toEqual(["1", "2", "4"]);
  });
  it("in no catalogue / in some catalogue", () => {
    expect(ids(applyFilters(rows, f({ catalogIn: [NONE] })).rows)).toEqual(["3"]);
    expect(ids(applyFilters(rows, f({ catalogIn: [ANY] })).rows)).toEqual(["1", "2", "4"]);
  });
  it("not in: none of the chosen", () => {
    expect(ids(applyFilters(rows, f({ catalogNot: ["c-uk"] })).rows)).toEqual(["3", "4"]);
    expect(ids(applyFilters(rows, f({ catalogNot: ["c-uk", "c-de"] })).rows)).toEqual(["3"]);
  });
  it("in and not in together", () => {
    expect(ids(applyFilters(rows, f({ catalogIn: ["c-uk"], catalogNot: ["c-de"] })).rows)).toEqual(["1"]);
  });
  it("published in a market uses the market's catalogues", () => {
    const ctx: FilterContext = { marketCatalogs: { uk: ["c-uk"], de: ["c-de"] } };
    expect(ids(applyFilters(rows, f({ market: ["de"] }), ctx).rows)).toEqual(["2", "4"]);
    expect(ids(applyFilters(rows, f({ market: ["uk", "de"], status: ["ACTIVE"] }), ctx).rows)).toEqual(["1", "4"]);
    expect(applyFilters(rows, f({ market: ["fr"] }), ctx).rows).toEqual([]);
  });
});

describe("search across columns", () => {
  it("finds a word in title, handle, vendor, type, tag, id, status or catalogue", () => {
    expect(ids(applyFilters(rows, f({ search: "walnut" })).rows)).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ search: "product-3" })).rows)).toEqual(["3"]);
    expect(ids(applyFilters(rows, f({ search: "other" })).rows)).toEqual(["2", "4"]);
    expect(ids(applyFilters(rows, f({ search: "rug" })).rows)).toEqual(["4"]);
    expect(ids(applyFilters(rows, f({ search: "chair" })).rows)).toEqual(["3"]);
    expect(ids(applyFilters(rows, f({ search: "gid://shopify/Product/2" })).rows)).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ search: "archived" })).rows)).toEqual(["3"]);
    expect(ids(applyFilters(rows, f({ search: "DE" })).rows)).toContain("2");
  });
  it("is case-insensitive", () => {
    expect(ids(applyFilters(rows, f({ search: "OAK DINING" })).rows)).toEqual(["1"]);
  });
  it("several words must all be found, each in any column", () => {
    // "oak" is in the title and a tag; "hardman" in the vendor; "chair" is the type.
    expect(ids(applyFilters(rows, f({ search: "oak hardman" })).rows)).toEqual(["1", "3"]);
    expect(ids(applyFilters(rows, f({ search: "oak chair hardman" })).rows)).toEqual(["3"]);
    expect(applyFilters(rows, f({ search: "oak rug" })).rows).toEqual([]);
  });
  it("extra columns (SKU, cell texts) are searched too", () => {
    const ctx: FilterContext = { searchColumns: (p) => (p.numericId === "2" ? ["SKU-AB-42", "Beech"] : []) };
    expect(ids(applyFilters(rows, f({ search: "sku-ab-42" }), ctx).rows)).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ search: "beech walnut" }), ctx).rows)).toEqual(["2"]);
    expect(applyFilters(rows, f({ search: "sku-ab-42" })).rows).toEqual([]);
  });
  it("blank search matches everything and extra spaces are fine", () => {
    expect(applyFilters(rows, f({ search: "   " })).rows).toHaveLength(4);
    expect(ids(applyFilters(rows, f({ search: "  oak   table " })).rows)).toEqual(["1"]);
    expect(searchWords("  A  b ")).toEqual(["a", "b"]);
  });
  it("the search combines with the sections", () => {
    expect(ids(applyFilters(rows, f({ search: "oak", tagNot: ["sale"] })).rows)).toEqual(["3"]);
  });
  it("helpers", () => {
    expect(matchesSearch(rows[0]!, "dining")).toBe(true);
    expect(matchesSearch(rows[0]!, "dining rug")).toBe(false);
    expect(identityText(rows[0]!)).toContain("oak dining table");
    expect(rowText(rows[0]!, ["Extra"])).toContain("extra");
  });
});

const stock = (s: Partial<StockSummary> & { id: string }): StockSummary => ({ variants: 1, complete: true, tracked: 1, stops: 1, soldOut: 0, locations: [{ id: "loc-1", name: "London", available: 5, variants: 1 }], ...s });

describe("stock and rows not read yet", () => {
  const summaries: Record<string, StockSummary> = {
    [rows[0]!.id]: stock({ id: rows[0]!.id }),
    [rows[1]!.id]: stock({ id: rows[1]!.id, soldOut: 1, tracked: 1 }),
  };
  it("judges availability, tracking and location", () => {
    expect(availabilityOf(summaries[rows[1]!.id]!)).toBe("soldout");
    expect(trackingOf(stock({ id: "x", variants: 2, tracked: 1 }))).toBe("some");
    const ctx: FilterContext = { stock: summaries };
    expect(ids(applyFilters(rows, f({ availability: ["available"] }), ctx).rows)).toEqual(["1"]);
    expect(ids(applyFilters(rows, f({ availability: ["soldout"] }), ctx).rows)).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ locations: ["loc-1"] }), ctx).rows)).toEqual(["1", "2"]);
  });
  it("counts rows whose stock is not read as waiting and does not show them", () => {
    const r = applyFilters(rows, f({ availability: ["available"] }), { stock: summaries });
    expect(ids(r.rows)).toEqual(["1"]);
    expect(r.waiting).toBe(2);
  });
  it("a row that already fails another filter is not counted as waiting", () => {
    const r = applyFilters(rows, f({ availability: ["available"], status: ["ACTIVE"] }), { stock: summaries });
    expect(ids(r.rows)).toEqual(["1"]);
    expect(r.waiting).toBe(1);
  });
  it("a row that fails a known stock filter is dropped even if another part is unread", () => {
    const ctx: FilterContext = { stock: summaries, collections: {} };
    const r = applyFilters(rows, f({ availability: ["soldout"], collection: ["col-1"] }), ctx);
    // Row 1 is available (fails), row 2 is sold out but the collection is unread, rows 3 and 4 have no stock yet.
    expect(r.rows).toEqual([]);
    expect(r.waiting).toBe(3);
  });
  it("nothing waits when no stock filter is on", () => {
    expect(applyFilters(rows, f({ status: ["ACTIVE"] }), { stock: {} }).waiting).toBe(0);
  });
});

describe("collection, translations, metafield", () => {
  it("collection: any of the chosen, waiting while a collection is read", () => {
    const members = { a: new Set([rows[0]!.id]), b: new Set([rows[3]!.id]) };
    expect(ids(applyFilters(rows, f({ collection: ["a", "b"] }), { collections: members }).rows)).toEqual(["1", "4"]);
    const partial = applyFilters(rows, f({ collection: ["a", "b"] }), { collections: { a: members.a } });
    expect(ids(partial.rows)).toEqual(["1"]);
    expect(partial.waiting).toBe(3);
  });
  it("translations: missing in a language, outdated, complete", () => {
    const states: Record<string, "missing" | "outdated" | "complete"> = { "1|fr": "missing", "2|fr": "complete", "3|fr": "outdated", "1|de": "complete" };
    const ctx: FilterContext = { translation: (p, slot) => states[`${p.numericId}|${slot}`] };
    const missing = applyFilters(rows, f({ translationMode: "missing", translationSlots: ["fr"] }), ctx);
    expect(ids(missing.rows)).toEqual(["1"]);
    expect(missing.waiting).toBe(1);
    expect(ids(applyFilters(rows, f({ translationMode: "outdated", translationSlots: ["fr"] }), ctx).rows)).toEqual(["3"]);
    expect(ids(applyFilters(rows, f({ translationMode: "complete", translationSlots: ["fr"] }), ctx).rows)).toEqual(["2"]);
  });
  it("translations with no language chosen look at every language", () => {
    const ctx: FilterContext = { translation: (p) => (p.numericId === "1" ? "missing" : "complete") };
    expect(ids(applyFilters(rows, f({ translationMode: "missing" }), ctx, ["fr", "de"]).rows)).toEqual(["1"]);
  });
  it("metafield empty / has a value, waiting until read", () => {
    const values: Record<string, boolean> = { "1": true, "2": false };
    const ctx: FilterContext = { metafieldEmpty: (p) => values[p.numericId] };
    const empty = applyFilters(rows, f({ metafield: "custom.x", metafieldState: "empty" }), ctx);
    expect(ids(empty.rows)).toEqual(["1"]);
    expect(empty.waiting).toBe(2);
    expect(ids(applyFilters(rows, f({ metafield: "custom.x", metafieldState: "filled" }), ctx).rows)).toEqual(["2"]);
    expect(applyFilters(rows, f({ metafield: "custom.x" }), ctx).rows).toHaveLength(4);
  });
});

describe("this page only", () => {
  it("asks the page and ANDs the page filters with the rest", () => {
    const ctx: FilterContext = { pageMatch: (p, page) => (page.size ?? [p.productType]).includes(p.productType) };
    expect(ids(applyFilters(rows, f({ page: { size: ["Table", "Rug"] } }), ctx).rows)).toEqual(["1", "4"]);
    expect(ids(applyFilters(rows, f({ page: { size: ["Table", "Rug"] }, status: ["ACTIVE"], tagNot: ["oak"] }), ctx).rows)).toEqual(["4"]);
    // The page is not asked when no page filter has a value.
    expect(applyFilters(rows, f({ page: { size: [] } }), { pageMatch: () => false }).rows).toHaveLength(4);
  });
});

describe("stockCandidates", () => {
  it("leaves out products another filter already rejected, so their stock is not read", () => {
    const members = { a: new Set([rows[0]!.id, rows[3]!.id]) };
    const found = stockCandidates(rows, f({ availability: ["available"], status: ["ACTIVE"], collection: ["a"], tagNot: ["oak"] }), { collections: members });
    expect(ids(found)).toEqual(["4"]);
  });
  it("keeps products whose collection is still being read", () => {
    expect(ids(stockCandidates(rows, f({ availability: ["available"], collection: ["a"] }), { collections: {} }))).toEqual(["1", "2", "3", "4"]);
  });
});

describe("applyBase", () => {
  it("applies only what needs no background data", () => {
    expect(ids(applyBase(rows, f({ status: ["ACTIVE"], availability: ["soldout"] })))).toEqual(["1", "4"]);
  });
});

describe("chips and counts", () => {
  const names = { catalogs: { "c-uk": "UK" }, markets: { uk: "United Kingdom" }, collections: { a: "Sale" }, locations: { "loc-1": "London" }, slots: { fr: "French" }, metafields: { "custom.x": "Colour" } };
  it("counts nothing when nothing is chosen, and not the search", () => {
    expect(countActive(NO_FILTERS)).toBe(0);
    expect(countActive(f({ search: "abc" }))).toBe(0);
    expect(isFiltering(f({ search: "abc" }))).toBe(true);
    expect(isFiltering(NO_FILTERS)).toBe(false);
  });
  it("one chip per value, with the standard wording", () => {
    const state = f({ status: ["ACTIVE"], tagNot: ["sale"], tag: ["oak"], catalogIn: ["c-uk"], catalogNot: [ANY], market: ["uk"], collection: ["a"], min: "2", locations: [NONE], translationMode: "missing", translationSlots: ["fr"], metafield: "custom.x", metafieldState: "empty" });
    const labels = describeChips(state, names).map((c) => c.label);
    expect(labels).toEqual([
      "Status: active",
      "Collection: Sale",
      "Tag: oak",
      "Tag excluded: sale",
      "Catalogue: UK",
      "Not in a catalogue",
      "Published in market: United Kingdom",
      "Stocked nowhere",
      "Variants: 2 or more",
      "Translation missing: French",
      "Metafield: Colour is empty",
    ]);
    expect(countActive(state)).toBe(11);
  });
  it("removing a chip takes out only that value", () => {
    const state = f({ tag: ["a", "b"], tagNot: ["c"], status: ["ACTIVE", "DRAFT"] });
    const chips = describeChips(state);
    const removed = chips.find((c) => c.label === "Tag excluded: c")!.remove(state);
    expect(removed.tagNot).toEqual([]);
    expect(removed.tag).toEqual(["a", "b"]);
    expect(chips.find((c) => c.label === "Status: draft")!.remove(state).status).toEqual(["ACTIVE"]);
  });
  it("variants chip, translation chips and page chips remove cleanly", () => {
    const state = f({ min: "1", max: "4", translationMode: "missing", translationSlots: ["fr"], page: { size: ["a", "b"] } });
    const chips = describeChips(state, { pageSections: [{ key: "size", label: "Size", options: [{ value: "a", label: "Small" }, { value: "b", label: "Big" }] }] });
    expect(chips.map((c) => c.label)).toEqual(["Variants: 1 to 4", "Translation missing: fr", "Size: Small", "Size: Big"]);
    expect(chips[0]!.remove(state)).toMatchObject({ min: "", max: "" });
    expect(chips[1]!.remove(state)).toMatchObject({ translationMode: "", translationSlots: [] });
    const left = chips[2]!.remove(state);
    expect(left.page).toEqual({ size: ["b"] });
    expect(chips[3]!.remove(left).page).toEqual({});
  });
  it("clearAll empties everything, search included", () => {
    expect(clearAll()).toEqual(NO_FILTERS);
    expect(clearAll().page).not.toBe(NO_FILTERS.page);
  });
  it("addValue never adds twice", () => {
    expect(addValue(["a"], "a")).toEqual(["a"]);
    expect(addValue(["a"], "b")).toEqual(["a", "b"]);
  });
  it("counts values for the pick lists", () => {
    const c = countValues(rows);
    expect(c.tag.get("oak")).toBe(2);
    expect(c.vendor.get("Other")).toBe(2);
    expect(c.catalog.get("c-uk")).toBe(2);
  });
});

describe("selection", () => {
  const all = rows;
  const filteredRows = applyFilters(all, f({ status: ["ACTIVE"] })).rows;
  it("show only selected ignores search and filters", () => {
    const selected = new Set([all[1]!.id, all[2]!.id]);
    expect(ids(visibleRows(all, filteredRows, selected, true))).toEqual(["2", "3"]);
    expect(ids(visibleRows(all, filteredRows, selected, false))).toEqual(["1", "4"]);
  });
  it("show only selected ignores a search that matches nothing", () => {
    const none = applyFilters(all, f({ search: "zzz" })).rows;
    expect(none).toEqual([]);
    expect(ids(visibleRows(all, none, new Set([all[0]!.id]), true))).toEqual(["1"]);
  });
  it("ticks survive changes of search, filters and paging (the set is not touched by them)", () => {
    const selected = new Set([all[1]!.id]);
    const afterFilter = applyFilters(all, f({ status: ["ACTIVE"] })).rows;
    expect(afterFilter.some((r) => selected.has(r.id))).toBe(false);
    expect(selected.has(all[1]!.id)).toBe(true);
    // The tick is still counted in the whole list, and shown again with the filter off.
    expect(ids(visibleRows(all, afterFilter, selected, true))).toEqual(["2"]);
    expect(matchingSelected(selected, afterFilter)).toBe(0);
    expect(matchingSelected(selected, all)).toBe(1);
  });
  it("select all matching ticks only the matching rows and keeps earlier ticks", () => {
    const selected = new Set([all[2]!.id]);
    const next = selectMatching(selected, filteredRows);
    expect([...next].sort()).toEqual([all[0]!.id, all[2]!.id, all[3]!.id].sort());
    expect(next).not.toBe(selected);
    expect(selected.size).toBe(1);
  });
  it("notes", () => {
    expect(onlySelectedNote(13)).toBe("Showing the 13 selected products (filters are ignored)");
    expect(onlySelectedNote(1)).toBe("Showing the 1 selected product (filters are ignored)");
    expect(onlySelectedStays(new Set(), true)).toBe(false);
    expect(onlySelectedStays(new Set(["a"]), true)).toBe(true);
  });
});
