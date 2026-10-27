import { describe, expect, it } from "vitest";
import {
  buildElements,
  computeNext,
  emptyDraft,
  encodeValue,
  formatValue,
  inputKindOf,
  isListType,
  opsFor,
  sameValue,
  typeLabel,
  canEditTranslations,
  referenceIds,
  type Draft,
} from "./mfTypes";

const draft = (kind: Parameters<typeof emptyDraft>[0], patch: Partial<Draft>): Draft => ({ ...emptyDraft(kind), ...patch });

describe("type helpers", () => {
  it("knows lists and kinds", () => {
    expect(isListType("list.product_reference")).toBe(true);
    expect(isListType("single_line_text_field")).toBe(false);
    expect(inputKindOf("list.product_reference")).toBe("ref-product");
    expect(inputKindOf("file_reference")).toBe("unsupported");
  });

  it("labels types in plain words", () => {
    expect(typeLabel("single_line_text_field")).toBe("Single line text");
    expect(typeLabel("list.product_reference")).toBe("List of product");
  });

  it("offers add/remove only for lists, and only delete for unsupported types", () => {
    expect(opsFor("single_line_text_field")).toEqual(["set", "clear"]);
    expect(opsFor("list.single_line_text_field")).toEqual(["add", "remove", "set", "clear"]);
    expect(opsFor("file_reference")).toEqual(["clear"]);
  });

  it("only plain single text can be translated here", () => {
    expect(canEditTranslations("single_line_text_field")).toBe(true);
    expect(canEditTranslations("multi_line_text_field")).toBe(true);
    expect(canEditTranslations("list.single_line_text_field")).toBe(false);
    expect(canEditTranslations("number_integer")).toBe(false);
  });
});

describe("buildElements", () => {
  it("rejects empty and multi-value input for single types", () => {
    expect(buildElements("single_line_text_field", draft("text", { text: "  " })).error).toBeTruthy();
    expect(buildElements("number_integer", draft("integer", { text: "1.5" })).error).toMatch(/whole number/);
    expect(buildElements("number_integer", draft("integer", { text: "12" })).elements).toEqual(["12"]);
  });

  it("builds one element per line for lists and uses numbers for integer lists", () => {
    expect(buildElements("list.single_line_text_field", draft("text", { text: "a\n\n b \n" })).elements).toEqual(["a", "b"]);
    expect(buildElements("list.number_integer", draft("integer", { text: "1\n2" })).elements).toEqual([1, 2]);
  });

  it("validates url, color, date", () => {
    expect(buildElements("url", draft("url", { text: "example.com" })).error).toBeTruthy();
    expect(buildElements("url", draft("url", { text: "https://example.com" })).error).toBeUndefined();
    expect(buildElements("color", draft("color", { text: "#ff00aa" })).elements).toEqual(["#FF00AA"]);
    expect(buildElements("date", draft("date", { text: "2026-13-40" })).error).toBeTruthy();
  });

  it("builds structured values", () => {
    expect(buildElements("dimension", draft("dimension", { text: "12.5", unit: "cm" })).elements).toEqual([{ value: 12.5, unit: "cm" }]);
    expect(buildElements("money", draft("money", { text: "5.99", currency: "eur" })).elements).toEqual([
      { amount: "5.99", currency_code: "EUR" },
    ]);
    expect(buildElements("rating", draft("rating", { text: "6", ratingMin: "1", ratingMax: "5" })).error).toMatch(/between/);
    expect(buildElements("rating", draft("rating", { text: "3.5", ratingMin: "1", ratingMax: "5" })).elements).toEqual([
      { scale_min: "1.0", scale_max: "5.0", value: "3.5" },
    ]);
  });

  it("checks references", () => {
    expect(buildElements("product_reference", draft("ref-product", {})).error).toBeTruthy();
    const refs = [{ id: "gid://shopify/Product/1", label: "A" }];
    expect(buildElements("product_reference", draft("ref-product", { refs })).elements).toEqual(["gid://shopify/Product/1"]);
    expect(
      buildElements("product_reference", draft("ref-product", { refs: [...refs, { id: "gid://shopify/Product/2", label: "B" }] })).error,
    ).toBeTruthy();
  });

  it("makes rich text from paragraphs", () => {
    const r = buildElements("rich_text_field", draft("richtext", { text: "One\n\nTwo" }));
    expect(JSON.stringify(r.elements[0])).toContain('"value":"Two"');
  });

  it("validates json", () => {
    expect(buildElements("json", draft("json", { text: "{oops" })).error).toBeTruthy();
    expect(buildElements("json", draft("json", { text: '{"a":1}' })).elements).toEqual(['{"a":1}']);
  });
});

describe("computeNext", () => {
  const P1 = "gid://shopify/Product/1";
  const P2 = "gid://shopify/Product/2";
  const P3 = "gid://shopify/Product/3";
  const type = "list.product_reference";

  it("adds only what is missing, keeping order", () => {
    const r = computeNext(type, JSON.stringify([P1]), "add", [P1, P2]);
    expect(r.changed).toBe(true);
    expect(JSON.parse(r.next as string)).toEqual([P1, P2]);
  });

  it("add is unchanged when everything is already there", () => {
    const r = computeNext(type, JSON.stringify([P1, P2]), "add", [P2]);
    expect(r.changed).toBe(false);
  });

  it("add starts a list when there is no value", () => {
    const r = computeNext(type, null, "add", [P3]);
    expect(JSON.parse(r.next as string)).toEqual([P3]);
  });

  it("removes only what is present", () => {
    const r = computeNext(type, JSON.stringify([P1, P2, P3]), "remove", [P2, "gid://shopify/Product/99"]);
    expect(JSON.parse(r.next as string)).toEqual([P1, P3]);
    expect(computeNext(type, JSON.stringify([P1]), "remove", [P2]).changed).toBe(false);
  });

  it("deletes the metafield when the list becomes empty", () => {
    const r = computeNext(type, JSON.stringify([P1]), "remove", [P1]);
    expect(r.next).toBeNull();
    expect(r.changed).toBe(true);
    expect(r.note).toMatch(/deleted/);
  });

  it("remove on a record with no value changes nothing", () => {
    expect(computeNext(type, null, "remove", [P1]).changed).toBe(false);
  });

  it("set replaces, and detects an identical list", () => {
    expect(computeNext(type, JSON.stringify([P1]), "set", [P2]).changed).toBe(true);
    expect(computeNext(type, JSON.stringify([P1, P2]), "set", [P1, P2]).changed).toBe(false);
    // a different order is a change
    expect(computeNext(type, JSON.stringify([P2, P1]), "set", [P1, P2]).changed).toBe(true);
  });

  it("clear deletes only when there is a value", () => {
    expect(computeNext(type, JSON.stringify([P1]), "clear", []).next).toBeNull();
    expect(computeNext(type, null, "clear", []).changed).toBe(false);
  });

  it("add and remove are refused for single values", () => {
    expect(computeNext("single_line_text_field", "x", "add", ["y"]).error).toBeTruthy();
  });

  it("set on a single value", () => {
    expect(computeNext("single_line_text_field", "Red", "set", ["Red"]).changed).toBe(false);
    const r = computeNext("single_line_text_field", "Red", "set", ["Blue"]);
    expect(r).toMatchObject({ next: "Blue", changed: true });
  });

  it("compares numbers and structured values by meaning, not by text", () => {
    expect(sameValue("number_decimal", "1.50", "1.5")).toBe(true);
    expect(sameValue("dimension", '{"value":5.0,"unit":"cm"}', '{"unit":"cm","value":5}')).toBe(true);
    expect(sameValue("list.number_integer", '["1","2"]', "[1,2]")).toBe(true);
  });

  it("adds to a list of structured values without duplicating", () => {
    const t = "list.dimension";
    const current = JSON.stringify([{ value: 5, unit: "cm" }]);
    expect(computeNext(t, current, "add", [{ value: 5.0, unit: "cm" }]).changed).toBe(false);
    expect(computeNext(t, current, "add", [{ value: 6, unit: "cm" }]).changed).toBe(true);
  });

  it("refuses unsupported types except delete", () => {
    expect(computeNext("file_reference", "gid://x", "set", ["a"]).error).toBeTruthy();
    expect(computeNext("file_reference", "gid://x", "clear", []).next).toBeNull();
  });

  it("encodes list and single values", () => {
    expect(encodeValue("list.single_line_text_field", ["a", "b"])).toBe('["a","b"]');
    expect(encodeValue("dimension", [{ value: 1, unit: "cm" }])).toBe('{"value":1,"unit":"cm"}');
  });
});

describe("formatValue", () => {
  it("shows readable values", () => {
    expect(formatValue("single_line_text_field", null)).toBe("—");
    expect(formatValue("boolean", "true")).toBe("Yes");
    expect(formatValue("list.single_line_text_field", '["a","b"]')).toBe("a, b");
    expect(formatValue("dimension", '{"value":5,"unit":"cm"}')).toBe("5 cm");
    expect(formatValue("money", '{"amount":"5.99","currency_code":"USD"}')).toBe("5.99 USD");
    expect(formatValue("list.product_reference", '["gid://shopify/Product/7"]')).toBe("Product 7");
    expect(formatValue("list.product_reference", '["gid://shopify/Product/7"]', { "gid://shopify/Product/7": "Shirt" })).toBe("Shirt");
    expect(formatValue("rich_text_field", '{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","value":"Hi"}]}]}')).toBe("Hi");
  });

  it("lists reference ids", () => {
    expect(referenceIds("list.product_reference", '["gid://shopify/Product/7"]')).toEqual(["gid://shopify/Product/7"]);
    expect(referenceIds("single_line_text_field", "x")).toEqual([]);
  });
});

import { draftFromValue } from "./mfTypes";

describe("draftFromValue", () => {
  it("fills simple, list and structured drafts", () => {
    expect(draftFromValue("single_line_text_field", "Red").text).toBe("Red");
    expect(draftFromValue("list.single_line_text_field", '["a","b"]').text).toBe("a\nb");
    expect(draftFromValue("boolean", "false").bool).toBe("false");
    expect(draftFromValue("dimension", '{"value":5,"unit":"kg"}')).toMatchObject({ text: "5", unit: "kg" });
    expect(draftFromValue("money", '{"amount":"5.99","currency_code":"EUR"}')).toMatchObject({ text: "5.99", currency: "EUR" });
    expect(draftFromValue("list.product_reference", '["gid://shopify/Product/1"]', { "gid://shopify/Product/1": "Shirt" }).refs).toEqual([
      { id: "gid://shopify/Product/1", label: "Shirt" },
    ]);
    expect(draftFromValue("single_line_text_field", null).text).toBe("");
  });

  it("round-trips a single value through buildElements", () => {
    const d = draftFromValue("number_decimal", "12.50");
    expect(buildElements("number_decimal", d).elements).toEqual(["12.50"]);
  });
});

import { inlineToStored, isInlineType } from "./mfTypes";

describe("inline editing", () => {
  it("knows which types are typed straight into a cell", () => {
    for (const t of ["single_line_text_field", "multi_line_text_field", "number_integer", "number_decimal", "url", "color", "date", "date_time", "boolean"]) {
      expect(isInlineType(t)).toBe(true);
    }
    for (const t of ["list.single_line_text_field", "dimension", "money", "json", "rich_text_field", "product_reference", "file_reference", "rating"]) {
      expect(isInlineType(t)).toBe(false);
    }
  });

  it("turns typed text into the stored value", () => {
    expect(inlineToStored("single_line_text_field", "  Red ")).toEqual({ value: "Red" });
    expect(inlineToStored("single_line_text_field", "   ")).toEqual({ value: null });
    expect(inlineToStored("number_integer", "007")).toEqual({ value: "7" });
    expect(inlineToStored("number_integer", "1.5").error).toMatch(/whole number/);
    expect(inlineToStored("number_decimal", "12.50")).toEqual({ value: "12.50" });
    expect(inlineToStored("color", "#aabbcc")).toEqual({ value: "#AABBCC" });
    expect(inlineToStored("url", "nope").error).toMatch(/valid URL/);
    expect(inlineToStored("multi_line_text_field", "a\nb  \n")).toEqual({ value: "a\nb" });
    expect(inlineToStored("boolean", "Yes")).toEqual({ value: "true" });
    expect(inlineToStored("boolean", "")).toEqual({ value: null });
    expect(inlineToStored("boolean", "maybe").error).toMatch(/true or false/);
  });
});
