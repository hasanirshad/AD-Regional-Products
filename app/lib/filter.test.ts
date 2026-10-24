import { describe, expect, it } from "vitest";
import { activeChips, ANY, applyFilters, filterOptions, NO_FILTERS, NONE } from "./filter";
import { parseProduct } from "./parse";
import type { Filters, ProductRow } from "./types";

const row = (id: string, over: Partial<ProductRow> = {}): ProductRow => ({
  id: `gid://shopify/Product/${id}`,
  numericId: id,
  title: `Product ${id}`,
  handle: `product-${id}`,
  vendor: "Hardman",
  productType: "Table",
  status: "ACTIVE",
  tags: [],
  catalogs: [],
  ...over,
});

const rows = [
  row("1", { title: "Oak table", tags: ["froede", "oak"], catalogs: [{ id: "c1", title: "UK" }] }),
  row("2", { title: "Walnut chair", vendor: "Other", productType: "Chair", status: "DRAFT", tags: ["walnut"] }),
  row("3", { title: "Stool", catalogs: [{ id: "c1", title: "UK" }, { id: "c2", title: "DE" }] }),
];
const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });
const ids = (list: ProductRow[]) => list.map((p) => p.numericId);

describe("applyFilters", () => {
  it("returns everything with no filters", () => {
    expect(ids(applyFilters(rows, NO_FILTERS, {}))).toEqual(["1", "2", "3"]);
  });
  it("searches title, handle, vendor, type and tags, ignoring case", () => {
    expect(ids(applyFilters(rows, f({ search: "OAK" }), {}))).toEqual(["1"]);
    expect(ids(applyFilters(rows, f({ search: "product-2" }), {}))).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ search: "other" }), {}))).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ search: "chair" }), {}))).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ search: "walnut" }), {}))).toEqual(["2"]);
  });
  it("filters by status, vendor, type and tag", () => {
    expect(ids(applyFilters(rows, f({ status: "DRAFT" }), {}))).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ vendor: "Other" }), {}))).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ productType: "Chair" }), {}))).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ tag: "froede" }), {}))).toEqual(["1"]);
  });
  it("catalogue: not in any, in any, or a specific one", () => {
    expect(ids(applyFilters(rows, f({ catalog: NONE }), {}))).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ catalog: ANY }), {}))).toEqual(["1", "3"]);
    expect(ids(applyFilters(rows, f({ catalog: "c2" }), {}))).toEqual(["3"]);
  });
  it("profile: General, or a specific profile", () => {
    const membership = { [rows[0]!.id]: "gA", [rows[2]!.id]: "gB" };
    expect(ids(applyFilters(rows, f({ profile: NONE }), membership))).toEqual(["2"]);
    expect(ids(applyFilters(rows, f({ profile: "gB" }), membership))).toEqual(["3"]);
  });
  it("combines filters", () => {
    expect(ids(applyFilters(rows, f({ catalog: "c1", search: "stool" }), {}))).toEqual(["3"]);
    expect(ids(applyFilters(rows, f({ catalog: "c1", status: "DRAFT" }), {}))).toEqual([]);
  });
});

describe("filterOptions", () => {
  it("collects sorted unique values and catalogues", () => {
    const o = filterOptions(rows);
    expect(o.vendors).toEqual(["Hardman", "Other"]);
    expect(o.types).toEqual(["Chair", "Table"]);
    expect(o.tags).toEqual(["froede", "oak", "walnut"]);
    expect(o.catalogs).toEqual([{ id: "c2", title: "DE" }, { id: "c1", title: "UK" }]);
  });
});

describe("activeChips", () => {
  const lookups = { catalogs: [{ id: "c1", title: "UK" }], profiles: [{ id: "gA", name: "Froede" }] };
  it("is empty with no filters", () => {
    expect(activeChips(NO_FILTERS, lookups)).toEqual([]);
  });
  it("labels each active filter", () => {
    const chips = activeChips(f({ status: "DRAFT", catalog: NONE, profile: "gA", tag: "oak" }), lookups);
    expect(chips.map((c) => c.label)).toEqual([
      "Status: draft",
      "Tag: oak",
      "Not in any catalogue",
      "Profile: Froede",
    ]);
  });
  it("names a specific catalogue", () => {
    expect(activeChips(f({ catalog: "c1" }), lookups)[0]?.label).toBe("Catalogue: UK");
  });
});

describe("parseProduct", () => {
  it("reads catalogues (deduplicated) and the numeric id", () => {
    const p = parseProduct({
      id: "gid://shopify/Product/123",
      title: "T",
      handle: "t",
      vendor: "V",
      productType: "",
      status: "ACTIVE",
      tags: ["a"],
      resourcePublicationsV2: {
        nodes: [
          { publication: { id: "p1", catalog: { id: "c1", title: "UK" } } },
          { publication: { id: "p1", catalog: { id: "c1", title: "UK" } } },
          { publication: { id: "p2", catalog: null } },
        ],
      },
    });
    expect(p.numericId).toBe("123");
    expect(p.catalogs).toEqual([{ id: "c1", title: "UK" }]);
  });
});
