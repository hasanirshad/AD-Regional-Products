import { describe, expect, it } from "vitest";
import { buildChanges, describeTagChange, invertChanges, summarize, toBundles, type ChangeContext } from "./changes";
import { tagsToValue } from "./canon";
import { countByTab, editCount, effective, putEdit, removeEdits, editsOfProduct, type EditMap } from "./edits";
import { targetKey, type Target, type Value } from "./model";

const P = "p1";
const title: Target = { kind: "product", productId: P, field: "title" };
const handle: Target = { kind: "product", productId: P, field: "handle" };
const tags: Target = { kind: "product", productId: P, field: "tags" };
const price: Target = { kind: "variant", productId: P, variantId: "v1", field: "price" };
const compare: Target = { kind: "variant", productId: P, variantId: "v1", field: "compareAtPrice" };
const stock: Target = { kind: "stock", productId: P, variantId: "v1", itemId: "i1", locationId: "l1" };
const mf: Target = { kind: "metafield", productId: P, ownerId: P, ownerKind: "PRODUCT", namespace: "custom", key: "material", type: "single_line_text_field" };
const vmf: Target = { kind: "metafield", productId: P, ownerId: "v1", ownerKind: "PRODUCTVARIANT", namespace: "custom", key: "length", type: "number_integer" };
const frTitle: Target = { kind: "translation", productId: P, resourceId: P, resource: "product", field: "title", slot: "fr" };

const base: Record<string, Value> = {
  [targetKey(title)]: "Table",
  [targetKey(handle)]: "table",
  [targetKey(tags)]: tagsToValue(["oak"]),
  [targetKey(price)]: "100.00",
  [targetKey(compare)]: null,
  [targetKey(stock)]: "5",
};

const make = (edits: EditMap): ChangeContext => ({
  baseOf: (t) => base[targetKey(t)] ?? null,
  effectiveOf: (t) => effective(edits, t, base[targetKey(t)] ?? null),
  productTitle: () => "Table",
  productHandle: () => "table",
  variantTitle: () => "Oak / 180",
  slotLabel: (s) => (s === "fr" ? "French" : s),
  locationName: () => "Shop",
  metafieldName: (t) => `${t.namespace}.${t.key}`,
});

const put = (edits: EditMap, t: Target, value: Value, extra = {}) => putEdit(edits, t, value, base[targetKey(t)] ?? null, extra);

describe("putEdit", () => {
  it("adds an edit, and removes it when the value goes back to the saved one", () => {
    let e: EditMap = {};
    e = put(e, title, "Oak table");
    expect(editCount(e)).toBe(1);
    e = put(e, title, " Table ");
    expect(editCount(e)).toBe(0);
  });
  it("returns the same map when nothing changes", () => {
    const e: EditMap = {};
    expect(put(e, title, "Table")).toBe(e);
  });
  it("keeps an edit with an error even if the value looks unchanged", () => {
    const e = put({}, mf, null, { error: "Enter a value" });
    expect(editCount(e)).toBe(1);
  });
  it("counts by tab and filters by product", () => {
    let e: EditMap = {};
    e = put(e, title, "A");
    e = put(e, tags, tagsToValue(["x"]));
    e = put(e, price, "9.00");
    e = put(e, mf, "Oak");
    e = put(e, frTitle, "Table fr");
    expect(countByTab(e)).toMatchObject({ basic: 2, tags: 1, prices: 1, productMeta: 1 });
    expect(editsOfProduct(e, "other")).toEqual({});
    expect(editCount(removeEdits(e, [targetKey(title)]))).toBe(4);
  });
});

describe("buildChanges", () => {
  it("lists changes with before and after, sorted by product then tab", () => {
    let e: EditMap = {};
    e = put(e, price, "120.00");
    e = put(e, title, "Oak table");
    e = put(e, frTitle, "Table en chêne");
    const built = buildChanges(e, make(e));
    expect(built.errors).toEqual([]);
    expect(built.changes.map((c) => c.label)).toEqual(["French · Title", "Title", "Price · Oak / 180"]);
    expect(built.changes[1]).toMatchObject({ before: "Table", after: "Oak table", tab: "basic" });
  });

  it("blocks the review for an empty title, a bad price and a negative stock", () => {
    let e: EditMap = {};
    e = put(e, title, "");
    e = put(e, price, "abc");
    e = put(e, stock, "-1");
    const msgs = buildChanges(e, make(e)).errors.map((i) => i.message);
    expect(msgs).toContain("Title: The title cannot be empty.");
    expect(msgs.some((m) => m.startsWith("Price") && m.includes("Enter a price"))).toBe(true);
    expect(msgs.some((m) => m.includes("cannot be negative"))).toBe(true);
  });

  it("a stock change must be a whole number", () => {
    const e = put({}, stock, "2.5");
    expect(buildChanges(e, make(e)).errors[0]!.message).toContain("Enter a whole number");
  });

  it("carries a metafield typing error into the blockers, with the row's name", () => {
    const e = put({}, vmf, null, { error: '"x" is not a whole number.' });
    const built = buildChanges(e, make(e));
    expect(built.changes).toEqual([]);
    expect(built.errors[0]!.message).toBe('custom.length · Oak / 180: "x" is not a whole number.');
  });

  it("warns, without blocking, about a compare-at price that is not higher, a long SEO title and a handle that will be changed", () => {
    let e: EditMap = {};
    e = put(e, compare, "90.00");
    e = put(e, { kind: "product", productId: P, field: "seoTitle" }, "x".repeat(80));
    e = put(e, handle, "Oak Table");
    const built = buildChanges(e, make(e));
    expect(built.errors).toEqual([]);
    const w = built.warnings.map((i) => i.message).join("|");
    expect(w).toContain("Not higher than the price");
    expect(w).toContain("70 characters");
    expect(w).toContain('Shopify will save this as "oak-table"');
  });

  it("rejects tags with commas and more than 250", () => {
    let e = put({}, tags, JSON.stringify(["a,b"]));
    expect(buildChanges(e, make(e)).errors[0]!.message).toContain("comma");
    e = put({}, tags, JSON.stringify(Array.from({ length: 251 }, (_, i) => `t${i}`)));
    expect(buildChanges(e, make(e)).errors[0]!.message).toContain("250 tags");
  });

  it("allows a translation equal to the source, and an empty one (it removes)", () => {
    let e = put({}, frTitle, "Table");
    expect(buildChanges(e, make(e)).errors).toEqual([]);
    expect(e).not.toEqual({});
  });
});

describe("bundles and summary", () => {
  it("groups by product and counts", () => {
    let e: EditMap = {};
    e = put(e, title, "A");
    e = put(e, price, "1.00");
    const built = buildChanges(e, make(e));
    const bundles = toBundles(built.changes, make(e));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.changes).toHaveLength(2);
    expect(summarize(built.changes)).toMatchObject({ total: 2, tabs: 2, products: 1 });
  });
});

describe("helpers", () => {
  it("describes a tag change", () => {
    expect(describeTagChange(tagsToValue(["a", "b"]), tagsToValue(["b", "c"]))).toBe("Added: c · Removed: a");
    expect(describeTagChange(null, null)).toBe("No change");
  });
  it("inverts changes for Undo", () => {
    const e = put({}, title, "New");
    const [c] = buildChanges(e, make(e)).changes;
    const [u] = invertChanges([c!]);
    expect(u).toMatchObject({ before: "New", after: "Table" });
  });
});

import { rowPatchesFrom, undoChanges } from "./changes";

describe("undo and row patches", () => {
  const e = put({}, title, "New");
  const [c] = buildChanges(e, make(e)).changes;
  it("builds the changes that put things back", () => {
    const [u] = undoChanges([{ target: c!.target, productId: c!.productId, productTitle: "Table", label: "Title", before: "Table", after: "New" }]);
    expect(u).toMatchObject({ id: targetKey(title), before: "New", after: "Table", tab: "basic" });
  });
  it("patches the product list from saved product fields only", () => {
    const e2 = put(put(put({}, title, "Oak"), tags, tagsToValue(["a", "b"])), price, "5.00");
    const out = rowPatchesFrom(buildChanges(e2, make(e2)).changes);
    expect(out).toEqual({ [P]: { title: "Oak", tags: ["a", "b"] } });
  });
});
