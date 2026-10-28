import { describe, expect, it } from "vitest";
import {
  NO_BULK_FILTERS,
  activeFilterCount,
  applyListFilters,
  applyValueFilters,
  cellText,
  filterColumns,
  listText,
  metafieldColumn,
  normalizePriceText,
  parseCell,
  parseTsv,
  planPaste,
  priceColumn,
  variantColumn,
  productColumn,
  sortRows,
  tableToTsv,
  targetOf,
  toTsv,
  translationColumn,
  type BulkFilters,
} from "./bulk";
import { loadCells, loadCollectionProducts, loadCollections, newCache, targetsFor } from "./bulkLoad";
import { tagsToValue } from "./canon";
import { fakeProduct, fakeVariant, FakeShopify } from "./fake";
import { targetKey } from "./model";
import type { ProductRow } from "../types";

const row = (n: number, extra: Partial<ProductRow> = {}): ProductRow => ({
  id: `gid://shopify/Product/${n}`,
  numericId: String(n),
  title: `Product ${n}`,
  handle: `product-${n}`,
  vendor: "Hardman",
  productType: "Table",
  status: "ACTIVE",
  tags: [],
  catalogs: [],
  variantCount: 1,
  ...extra,
});

const def = (type: string, validations: { name: string; value: string | null }[] = []) => ({ namespace: "custom", key: "material", name: "Material", type, validations });

describe("columns and targets", () => {
  it("maps columns to targets", () => {
    const P = "gid://shopify/Product/1";
    expect(targetOf(productColumn("title"), P, null)).toEqual({ kind: "product", productId: P, field: "title" });
    expect(targetOf(priceColumn("price"), P, null)).toBeNull();
    expect(targetOf(priceColumn("price"), P, "v1")).toMatchObject({ kind: "variant", variantId: "v1", field: "price" });
    expect(targetOf(variantColumn("sku"), P, "v1")).toMatchObject({ kind: "variant", variantId: "v1", field: "sku" });
    expect(targetOf(variantColumn("sku"), P, null)).toBeNull();
    expect(targetOf(translationColumn("descriptionHtml", "fr", "French"), P, null)).toMatchObject({ kind: "translation", field: "body_html", slot: "fr", resourceId: P });
    expect(targetOf(metafieldColumn(def("single_line_text_field")), P, null)).toMatchObject({ kind: "metafield", ownerKind: "PRODUCT", key: "material" });
  });
  it("marks metafields of complex types as shown only", () => {
    expect(metafieldColumn(def("single_line_text_field")).editable).toBe(true);
    expect(metafieldColumn(def("list.single_line_text_field")).editable).toBe(false);
    expect(metafieldColumn(def("rich_text_field")).editable).toBe(false);
    expect(metafieldColumn(def("number_integer")).editable).toBe(true);
  });
});

describe("cells", () => {
  it("shows stored values as text", () => {
    expect(cellText(productColumn("tags"), tagsToValue(["b", "a"]))).toBe("b, a");
    expect(cellText(productColumn("status"), "DRAFT")).toBe("Draft");
    expect(cellText(productColumn("title"), null)).toBe("");
    expect(cellText(metafieldColumn(def("list.single_line_text_field")), JSON.stringify(["x", "y"]))).toBe("x, y");
  });

  it("reads tags, status and prices", () => {
    expect(parseCell(productColumn("tags"), "Sale, sale; new\nOak")).toEqual({ value: JSON.stringify(["Sale", "new", "Oak"]) });
    expect(parseCell(productColumn("tags"), " ").value).toBeNull();
    expect(parseCell(productColumn("status"), " Archived ")).toEqual({ value: "ARCHIVED" });
    expect(parseCell(productColumn("status"), "live").error).toContain("is not a status");
    expect(parseCell(priceColumn("price"), "49,9")).toEqual({ value: "49.9" });
    expect(parseCell(priceColumn("price"), "abc").error).toContain("is not a price");
    expect(parseCell(priceColumn("compareAtPrice"), "").value).toBeNull();
    // SKU and barcode are plain text, and an empty cell clears them
    expect(parseCell(variantColumn("sku"), "  OT-180 ")).toEqual({ value: "OT-180" });
    expect(parseCell(variantColumn("sku"), "").value).toBeNull();
    expect(variantColumn("barcode")).toMatchObject({ group: "Variant", input: "text", variantField: "barcode" });
  });

  it("normalises price text from other countries", () => {
    expect(normalizePriceText("€ 12,50")).toBe("12.50");
    expect(normalizePriceText("1.250,00")).toBe("1250.00");
    expect(normalizePriceText("1,250.00")).toBe("1250.00");
    expect(normalizePriceText("CHF 99")).toBe("99");
    expect(normalizePriceText("abc")).toBe("abc");
  });

  it("types metafield cells and checks the definition's rules", () => {
    const whole = metafieldColumn(def("number_integer"));
    expect(parseCell(whole, "12")).toEqual({ value: "12" });
    expect(parseCell(whole, "1.5").error).toBeTruthy();
    const choice = metafieldColumn(def("single_line_text_field", [{ name: "choices", value: JSON.stringify(["Oak", "Walnut"]) }]));
    expect(parseCell(choice, "Oak").error).toBeUndefined();
    expect(parseCell(choice, "Pine").error).toContain("allowed choices");
    expect(parseCell(choice, "").value).toBeNull();
    const bool = metafieldColumn(def("boolean"));
    expect(parseCell(bool, "yes")).toEqual({ value: "true" });
    expect(parseCell(bool, "maybe").error).toBeTruthy();
  });

  it("refuses to edit a read-only column", () => {
    expect(parseCell(metafieldColumn(def("list.single_line_text_field")), "x").error).toContain("cannot be edited");
  });

  it("empty text means nothing (null), long text keeps its lines", () => {
    expect(parseCell(productColumn("vendor"), "  ").value).toBeNull();
    expect(parseCell(productColumn("descriptionHtml"), "<p>a</p>\r\n<p>b</p>").value).toBe("<p>a</p>\n<p>b</p>");
  });
});

describe("filters", () => {
  const rows = [
    row(1, { vendor: "A", tags: ["sale"], status: "ACTIVE", catalogs: [{ id: "c1", title: "UK" } as never] }),
    row(2, { vendor: "B", tags: ["new"], status: "DRAFT" }),
    row(3, { vendor: "A", productType: "Chair" }),
  ];
  const f = (x: Partial<BulkFilters>): BulkFilters => ({ ...NO_BULK_FILTERS, ...x });

  it("combines list filters with AND", () => {
    expect(applyListFilters(rows, f({ vendor: "A" }), null).map((r) => r.numericId)).toEqual(["1", "3"]);
    expect(applyListFilters(rows, f({ vendor: "A", productType: "Chair" }), null).map((r) => r.numericId)).toEqual(["3"]);
    expect(applyListFilters(rows, f({ tag: "new" }), null).map((r) => r.numericId)).toEqual(["2"]);
    expect(applyListFilters(rows, f({ search: "PRODUCT-3" }), null).map((r) => r.numericId)).toEqual(["3"]);
  });
  it("filters by market catalogue, in or not in", () => {
    expect(applyListFilters(rows, f({ catalog: "c1" }), null).map((r) => r.numericId)).toEqual(["1"]);
    expect(applyListFilters(rows, f({ catalog: "c1", catalogMode: "not" }), null).map((r) => r.numericId)).toEqual(["2", "3"]);
  });
  it("filters by collection", () => {
    expect(applyListFilters(rows, f({ collection: "x" }), new Set([rows[1]!.id])).map((r) => r.numericId)).toEqual(["2"]);
  });
  it("counts the active filters", () => {
    expect(activeFilterCount(f({ vendor: "A", tag: "x", missingSlot: "fr" }))).toBe(3);
    expect(activeFilterCount(f({ search: "x" }))).toBe(0);
  });

  it("finds products with a missing translation, and counts the ones not read yet", () => {
    const known = new Map<string, string | null>();
    const put = (p: ProductRow, field: string, key: string, src: string | null, tr: string | null) => {
      known.set(targetKey({ kind: "product", productId: p.id, field: field as never }), src);
      known.set(targetKey({ kind: "translation", productId: p.id, resourceId: p.id, resource: "product", field: key, slot: "fr" }), tr);
    };
    const fill = (p: ProductRow, missing: boolean) => {
      put(p, "title", "title", p.title, "T");
      put(p, "descriptionHtml", "body_html", "<p>x</p>", missing ? null : "<p>y</p>");
      put(p, "seoTitle", "meta_title", null, null);
      put(p, "seoDescription", "meta_description", null, null);
    };
    fill(rows[0]!, true);
    fill(rows[1]!, false);
    const out = applyValueFilters(rows, f({ missingSlot: "fr" }), [], (id, t) => known.get(targetKey(t)));
    expect(out.rows.map((r) => r.numericId)).toEqual(["1"]);
    expect(out.waiting).toBe(1);
  });

  it("finds products with an empty metafield", () => {
    const d = { id: "d", ownerKind: "PRODUCT" as const, namespace: "custom", key: "material", name: "Material", description: "", type: "single_line_text_field", validations: [] };
    const values: Record<string, string | null> = { [rows[0]!.id]: "Oak", [rows[1]!.id]: null };
    const lookup = (id: string) => values[id];
    const out = applyValueFilters(rows, f({ emptyMetafield: "custom.material" }), [d], lookup);
    expect(out.rows.map((r) => r.numericId)).toEqual(["2"]);
    expect(out.waiting).toBe(1);
  });

  it("needs the source and translation columns to judge", () => {
    const cols = filterColumns(f({ missingSlot: "fr" }), []);
    expect(cols.map((c) => c.id)).toContain("t:fr:descriptionHtml");
    expect(cols.map((c) => c.id)).toContain("p:descriptionHtml");
  });
});

describe("sorting", () => {
  const items = [{ t: "b10" }, { t: "" }, { t: "b2" }, { t: "A" }];
  const text = (r: { t: string }) => r.t;
  it("sorts naturally, empty last in both directions", () => {
    expect(sortRows(items, { column: "x", dir: "asc" }, text).map(text)).toEqual(["A", "b2", "b10", ""]);
    expect(sortRows(items, { column: "x", dir: "desc" }, text).map(text)).toEqual(["b10", "b2", "A", ""]);
  });
  it("sorts numbers as numbers", () => {
    const nums = [{ t: "100.00" }, { t: "9.50" }, { t: "20" }];
    expect(sortRows(nums, { column: "p", dir: "asc" }, text).map(text)).toEqual(["9.50", "20", "100.00"]);
  });
  it("keeps the order with no sort and for ties", () => {
    expect(sortRows(items, null, text)).toBe(items);
    const same = [{ t: "a", i: 1 }, { t: "a", i: 2 }];
    expect(sortRows(same, { column: "x", dir: "desc" }, (r) => r.t).map((r) => r.i)).toEqual([1, 2]);
  });
  it("gives list text for sortable product columns", () => {
    expect(listText(row(1), "title")).toBe("Product 1");
    expect(listText(row(1), "seoTitle")).toBeNull();
  });
});

describe("spreadsheet text", () => {
  it("parses tabs, quotes, new lines inside quotes and a trailing blank line", () => {
    const t = 'Handle\tTitle\tDescription\r\na\tHello\t"line 1\nline ""2"""\r\nb\t\t\r\n\r\n';
    expect(parseTsv(t)).toEqual([["Handle", "Title", "Description"], ["a", "Hello", 'line 1\nline "2"'], ["b", "", ""]]);
  });
  it("round-trips through toTsv", () => {
    const rows = [["a", 'x\ty', "n\nm", 'q"q'], ["", "", "", ""]];
    expect(parseTsv(toTsv(rows))).toEqual([rows[0]!]);
  });
  it("round-trips a table export", () => {
    const cols = [productColumn("title"), productColumn("tags")];
    const text = tableToTsv(cols, [row(1, { tags: ["a", "b"] })], (r, c) => (c.id === "p:title" ? r.title : r.tags.join(", ")));
    expect(text).toBe("Handle\tTitle\tTags\nproduct-1\tProduct 1\ta, b");
  });
});

describe("planPaste", () => {
  const cols = [productColumn("title"), productColumn("tags"), metafieldColumn(def("list.single_line_text_field"))];
  const products = [row(1), row(2), row(3, { title: "Product 2" })];

  it("matches rows by handle, skips empty cells and turns [clear] into an empty value", () => {
    const plan = planPaste(parseTsv("Handle\tTitle\tTags\nproduct-1\tNew title\t[clear]\nproduct-2\t\tx, y"), cols, products);
    expect(plan.problem).toBeNull();
    expect(plan.matchedBy).toBe("handle");
    expect(plan.edits.map((e) => [e.productId.slice(-1), e.column.id, e.text])).toEqual([["1", "p:title", "New title"], ["1", "p:tags", ""], ["2", "p:tags", "x, y"]]);
  });
  it("reports unknown and read-only columns, unmatched rows and ambiguous titles", () => {
    const plan = planPaste(parseTsv("Title\tNope\tMaterial\nProduct 2\ta\tb\nProduct 1\t\t\nMissing\tx\ty"), cols, products);
    expect(plan.matchedBy).toBe("title");
    expect(plan.ambiguous).toEqual(["Product 2"]);
    expect(plan.unmatched).toEqual(["Missing"]);
    expect(plan.unknownColumns).toEqual(["Nope"]);
    expect(plan.readOnlyColumns).toEqual(["Material"]);
  });
  it("matches an id or a full gid", () => {
    const plan = planPaste(parseTsv("ID\tTitle\n2\tx\ngid://shopify/Product/1\ty"), cols, products);
    expect(plan.edits).toHaveLength(2);
  });
  it("explains a paste that cannot work", () => {
    expect(planPaste([["Handle"]], cols, products).problem).toContain("header row");
    expect(planPaste(parseTsv("Colour\tTitle\nx\ty"), cols, products).problem).toContain("must be Handle");
    expect(planPaste(parseTsv("Handle\tWeight\nproduct-1\t5"), cols, products).problem).toContain("None of the headers");
    expect(planPaste(parseTsv("Handle\tTitle\nproduct-1\t"), cols, products).problem).toContain("all empty");
  });
  it("does not edit one product twice", () => {
    const plan = planPaste(parseTsv("Handle\tTitle\nproduct-1\ta\nproduct-1\tb"), cols, products);
    expect(plan.edits).toHaveLength(1);
    expect(plan.ambiguous).toEqual(["product-1 (listed twice)"]);
  });
});

describe("loading cells", () => {
  const P1 = "gid://shopify/Product/1";
  const P2 = "gid://shopify/Product/2";
  const shop = () =>
    new FakeShopify([
      fakeProduct(P1, { title: "One", variants: [fakeVariant("v1", { price: "10.00" })] }),
      fakeProduct(P2, { title: "Two", variants: [fakeVariant("v2", { price: "20.00" }), fakeVariant("v3", { position: 2 })] }),
    ]);

  it("reads columns for products, finds single variants, and skips what is cached", async () => {
    const s = shop();
    const cache = newCache();
    const cols = [productColumn("title"), priceColumn("price")];
    const progress: number[] = [];
    const done = await loadCells(s.gql, [P1, P2], cols, cache, { onProgress: (d) => progress.push(d) });
    expect(done).toBe(2);
    expect(progress).toEqual([2]);
    expect(cache.variantIds.get(P1)).toBe("v1");
    expect(cache.variantIds.get(P2)).toBeNull();
    expect(cache.values.get(targetKey({ kind: "product", productId: P2, field: "title" }))).toBe("Two");
    expect(cache.values.get(targetKey({ kind: "variant", productId: P1, variantId: "v1", field: "price" }))).toBe("10.00");
    const before = s.count("ReadProductFields");
    await loadCells(s.gql, [P1, P2], cols, cache);
    expect(s.count("ReadProductFields")).toBe(before);
  });

  it("stops between groups when asked", async () => {
    const s = shop();
    const done = await loadCells(s.gql, [P1, P2], [productColumn("title")], newCache(), { shouldStop: () => true });
    expect(done).toBe(0);
  });

  it("builds only the targets that apply", () => {
    const vids = new Map<string, string | null>([[P1, "v1"], [P2, null]]);
    const t = targetsFor([priceColumn("price")], [P1, P2], vids);
    expect(t).toHaveLength(1);
  });

  it("reads collections and their products", async () => {
    const s = shop();
    s.collections.set("gid://shopify/Collection/1", { title: "Tables", productIds: [P1] });
    expect(await loadCollections(s.gql)).toEqual([{ id: "gid://shopify/Collection/1", title: "Tables" }]);
    expect([...(await loadCollectionProducts(s.gql, "gid://shopify/Collection/1"))]).toEqual([P1]);
    await expect(loadCollectionProducts(s.gql, "gid://shopify/Collection/9")).rejects.toThrow("no longer exists");
  });
});
