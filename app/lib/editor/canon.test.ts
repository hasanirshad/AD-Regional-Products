import { describe, expect, it } from "vitest";
import { dedupeTags, diffTags, formatPrice, normText, parseNumber, rememberCategory, sameFor, showValue, slugify, tagsFromValue, tagsToValue, translationStatus } from "./canon";
import type { Target } from "./model";

const p = (field: "title" | "tags" | "handle" | "status" | "category"): Target => ({ kind: "product", productId: "p", field });
const v = (field: "price" | "compareAtPrice" | "tracked" | "policy"): Target => ({ kind: "variant", productId: "p", variantId: "v", field });

describe("text", () => {
  it("normalises line endings and blank space", () => {
    expect(normText("  a\r\nb \n")).toBe("a\nb");
    expect(normText(null)).toBe("");
  });
  it("slugifies like a handle", () => {
    expect(slugify(" Café  Table #2 ")).toBe("cafe-table-2");
    expect(slugify("--A--")).toBe("a");
  });
});

describe("numbers", () => {
  it("parses only plain decimals", () => {
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber(" 7 ")).toBe(7);
    expect(parseNumber("1,5")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(formatPrice("5")).toBe("5.00");
  });
});

describe("tags", () => {
  it("are one tag whatever the case, first spelling wins", () => {
    expect(dedupeTags(["Sofa", "sofa", " oak ", ""])).toEqual(["Sofa", "oak"]);
  });
  it("round-trip through a value; no tags is null", () => {
    expect(tagsFromValue(tagsToValue(["a", "b"]))).toEqual(["a", "b"]);
    expect(tagsToValue([])).toBeNull();
    expect(tagsFromValue("not json")).toEqual([]);
  });
  it("diff ignores case", () => {
    expect(diffTags(["A", "b"], ["a", "c"])).toEqual({ added: ["c"], removed: ["b"] });
  });
});

describe("sameFor", () => {
  it("treats empty text and null as the same, and ignores edge spaces", () => {
    expect(sameFor(p("title"), "  Table ", "Table")).toBe(true);
    expect(sameFor(p("title"), "", null)).toBe(true);
    expect(sameFor(p("title"), "A", "B")).toBe(false);
  });
  it("tags: order and case do not matter", () => {
    expect(sameFor(p("tags"), JSON.stringify(["B", "a"]), JSON.stringify(["a", "b"]))).toBe(true);
    expect(sameFor(p("tags"), JSON.stringify(["a"]), null)).toBe(false);
  });
  it("handle: Shopify's spelling counts", () => {
    expect(sameFor(p("handle"), "My Table", "my-table")).toBe(true);
  });
  it("price: 10 and 10.00 are the same; a blank compare-at and 0.00 are the same", () => {
    expect(sameFor(v("price"), "10", "10.00")).toBe(true);
    expect(sameFor(v("price"), "10", "11")).toBe(false);
    expect(sameFor(v("compareAtPrice"), null, "0.00")).toBe(true);
    expect(sameFor(v("compareAtPrice"), "", null)).toBe(true);
    expect(sameFor(v("compareAtPrice"), "20", null)).toBe(false);
  });
  it("metafields compare by type: 1.0 and 1 are the same integer-like decimals", () => {
    const t: Target = { kind: "metafield", productId: "p", ownerId: "p", ownerKind: "PRODUCT", namespace: "c", key: "k", type: "number_decimal" };
    expect(sameFor(t, "1.0", "1")).toBe(true);
    expect(sameFor(t, null, "1")).toBe(false);
    expect(sameFor(t, null, null)).toBe(true);
  });
  it("stock compares numbers", () => {
    const t: Target = { kind: "stock", productId: "p", variantId: "v", itemId: "i", locationId: "l" };
    expect(sameFor(t, "5", "5.0")).toBe(true);
    expect(sameFor(t, "5", "6")).toBe(false);
  });
});

describe("showValue", () => {
  it("shows an em dash for nothing and readable words for the rest", () => {
    expect(showValue(p("title"), "")).toBe("—");
    expect(showValue(p("status"), "ACTIVE")).toBe("Active");
    expect(showValue(p("tags"), JSON.stringify(["a", "b"]))).toBe("a, b");
    expect(showValue(v("tracked"), "true")).toBe("Yes");
    expect(showValue(v("policy"), "CONTINUE")).toBe("Keep selling");
    rememberCategory("gid://shopify/TaxonomyCategory/aa-1", "Tables");
    expect(showValue(p("category"), "gid://shopify/TaxonomyCategory/aa-1")).toBe("Tables");
    expect(showValue(p("category"), "gid://shopify/TaxonomyCategory/aa-9")).toBe("aa-9");
  });
  it("shows a metafield by its type", () => {
    const t: Target = { kind: "metafield", productId: "p", ownerId: "p", ownerKind: "PRODUCT", namespace: "c", key: "k", type: "dimension" };
    expect(showValue(t, JSON.stringify({ value: 180, unit: "cm" }))).toBe("180 cm");
  });
});

describe("translationStatus", () => {
  it("covers translated, missing, same, outdated and no source", () => {
    expect(translationStatus("Table", "Tisch", false)).toBe("translated");
    expect(translationStatus("Table", "", false)).toBe("missing");
    expect(translationStatus("Table", null, false)).toBe("missing");
    expect(translationStatus("Table", " Table ", false)).toBe("same");
    expect(translationStatus("Table", "Tisch", true)).toBe("outdated");
    expect(translationStatus("", "Tisch", false)).toBe("no-source");
    expect(translationStatus(null, null, false)).toBe("no-source");
  });
  it("a missing translation stays missing even if the flag is set", () => {
    expect(translationStatus("Table", "", true)).toBe("missing");
  });
});
