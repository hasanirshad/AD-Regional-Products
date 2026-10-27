import { describe, expect, it } from "vitest";
import { draftsFromStored, newDraft, ratingScale, storedFromDrafts, supportOf, translatableMetafield, valueEditable } from "./mfModel";
import type { Draft } from "./mfTypes";

const d = (over: Partial<Draft>, type = "single_line_text_field"): Draft => ({ ...newDraft(type), ...over });

describe("supportOf", () => {
  it("edits the common types and lists of them", () => {
    for (const t of ["single_line_text_field", "multi_line_text_field", "rich_text_field", "number_integer", "number_decimal", "boolean", "date", "date_time", "color", "url", "json", "dimension", "weight", "volume", "money", "rating", "product_reference", "collection_reference", "variant_reference", "list.single_line_text_field", "list.number_integer", "list.product_reference", "list.dimension", "list.color"]) {
      expect(supportOf(t), t).toEqual({ editable: true });
    }
  });
  it("shows media and other references read-only, with the reason", () => {
    const file = supportOf("file_reference");
    expect(file.editable).toBe(false);
    expect(file.editable ? "" : file.reason).toContain("media");
    expect(supportOf("list.file_reference").editable).toBe(false);
    expect(supportOf("metaobject_reference").editable).toBe(false);
    expect(supportOf("list.metaobject_reference").editable).toBe(false);
    expect(supportOf("customer_reference").editable).toBe(false);
    expect(supportOf("something_new").editable).toBe(false);
  });
});

describe("translatableMetafield", () => {
  it("allows text, multi-line, rich text, url and a list of text only", () => {
    expect(translatableMetafield("single_line_text_field")).toBe(true);
    expect(translatableMetafield("multi_line_text_field")).toBe(true);
    expect(translatableMetafield("rich_text_field")).toBe(true);
    expect(translatableMetafield("url")).toBe(true);
    expect(translatableMetafield("list.single_line_text_field")).toBe(true);
    expect(translatableMetafield("number_integer")).toBe(false);
    expect(translatableMetafield("boolean")).toBe(false);
    expect(translatableMetafield("dimension")).toBe(false);
    expect(translatableMetafield("list.product_reference")).toBe(false);
  });
});

describe("single values", () => {
  it("an empty box is no value (the metafield is removed)", () => {
    expect(storedFromDrafts("single_line_text_field", [d({ text: "  " })])).toEqual({ value: null, error: null, itemErrors: [null] });
  });
  it("text is trimmed", () => {
    expect(storedFromDrafts("single_line_text_field", [d({ text: " Oak " })]).value).toBe("Oak");
  });
  it("integer: stored as plain digits; a word is an error with a clear sentence", () => {
    expect(storedFromDrafts("number_integer", [d({ text: "042" }, "number_integer")]).value).toBe("42");
    const bad = storedFromDrafts("number_integer", [d({ text: "4.5" }, "number_integer")]);
    expect(bad.value).toBeNull();
    expect(bad.error).toContain("not a whole number");
  });
  it("decimal and url and colour and date are checked", () => {
    expect(storedFromDrafts("number_decimal", [d({ text: "1.25" }, "number_decimal")]).value).toBe("1.25");
    expect(storedFromDrafts("number_decimal", [d({ text: "1,25" }, "number_decimal")]).error).toContain("not a number");
    expect(storedFromDrafts("url", [d({ text: "example.com" }, "url")]).error).toContain("not a valid URL");
    expect(storedFromDrafts("color", [d({ text: "#ff0000" }, "color")]).value).toBe("#FF0000");
    expect(storedFromDrafts("color", [d({ text: "red" }, "color")]).error).toContain("#RRGGBB");
    expect(storedFromDrafts("date", [d({ text: "2026-02-30x" }, "date")]).error).toContain("YYYY-MM-DD");
    expect(storedFromDrafts("date_time", [d({ text: "2026-10-24T09:00:00Z" }, "date_time")]).value).toBe("2026-10-24T09:00:00Z");
  });
  it("json must parse", () => {
    expect(storedFromDrafts("json", [d({ text: '{"a":1}' }, "json")]).value).toBe('{"a":1}');
    expect(storedFromDrafts("json", [d({ text: "{a" }, "json")]).error).toContain("valid JSON");
  });
  it("boolean: not set, true, false", () => {
    expect(storedFromDrafts("boolean", [d({ text: "" }, "boolean")]).value).toBeNull();
    expect(storedFromDrafts("boolean", [d({ text: "true" }, "boolean")]).value).toBe("true");
    expect(storedFromDrafts("boolean", [d({ text: "false" }, "boolean")]).value).toBe("false");
  });
  it("dimension, weight and volume need a number and a unit", () => {
    expect(storedFromDrafts("dimension", [d({ text: "180", unit: "cm" }, "dimension")]).value).toBe('{"value":180,"unit":"cm"}');
    expect(storedFromDrafts("weight", [d({ text: "abc", unit: "kg" }, "weight")]).error).toBe("Enter a number.");
    expect(storedFromDrafts("volume", [d({ text: "2", unit: "nope" }, "volume")]).error).toBe("Choose a unit.");
  });
  it("money and rating", () => {
    expect(storedFromDrafts("money", [d({ text: "10", currency: "gbp" }, "money")]).value).toBe('{"amount":"10","currency_code":"GBP"}');
    expect(storedFromDrafts("rating", [d({ text: "9", ratingMin: "1", ratingMax: "5" }, "rating")]).error).toContain("between 1 and 5");
  });
  it("rich text: markup becomes a tree", () => {
    const v = storedFromDrafts("rich_text_field", [d({ text: "Hello **world**" }, "rich_text_field")]).value!;
    expect(JSON.parse(v).children[0].children[1]).toEqual({ type: "text", value: "world", bold: true });
  });
});

describe("definition rules", () => {
  it("choices, min and max, pattern", () => {
    const choices = [{ name: "choices", value: '["Oak","Ash"]' }];
    expect(storedFromDrafts("single_line_text_field", [d({ text: "Pine" })], choices).error).toContain("allowed choices");
    expect(storedFromDrafts("single_line_text_field", [d({ text: "Ash" })], choices).error).toBeNull();
    const range = [{ name: "min", value: "1" }, { name: "max", value: "10" }];
    expect(storedFromDrafts("number_integer", [d({ text: "11" }, "number_integer")], range).error).toContain("at most 10");
  });
});

describe("lists", () => {
  it("one box per item; empty boxes are dropped; none at all is no value", () => {
    const t = "list.single_line_text_field";
    expect(storedFromDrafts(t, [d({ text: "a" }, t), d({ text: "" }, t), d({ text: "b" }, t)]).value).toBe('["a","b"]');
    expect(storedFromDrafts(t, []).value).toBeNull();
    expect(storedFromDrafts(t, [d({ text: "" }, t)]).value).toBeNull();
  });
  it("order is kept, so reordering changes the value", () => {
    const t = "list.single_line_text_field";
    expect(storedFromDrafts(t, [d({ text: "b" }, t), d({ text: "a" }, t)]).value).toBe('["b","a"]');
  });
  it("integer lists store numbers; a bad item is named", () => {
    const t = "list.number_integer";
    expect(storedFromDrafts(t, [d({ text: "1" }, t), d({ text: "2" }, t)]).value).toBe("[1,2]");
    const bad = storedFromDrafts(t, [d({ text: "1" }, t), d({ text: "x" }, t)]);
    expect(bad.error).toContain("not a whole number");
    expect(bad.itemErrors).toEqual([null, bad.error]);
  });
  it("list length rules", () => {
    const t = "list.single_line_text_field";
    const rules = [{ name: "list.max", value: "2" }];
    expect(storedFromDrafts(t, [d({ text: "a" }, t), d({ text: "b" }, t), d({ text: "c" }, t)], rules).error).toContain("at most 2 items");
  });
  it("dimension lists", () => {
    const t = "list.dimension";
    expect(storedFromDrafts(t, [d({ text: "1", unit: "cm" }, t), d({ text: "2", unit: "m" }, t)]).value).toBe('[{"value":1,"unit":"cm"},{"value":2,"unit":"m"}]');
  });
});

describe("references", () => {
  it("one id for a single reference, a JSON list for a list", () => {
    const refs = [{ id: "gid://shopify/Product/1", label: "A" }, { id: "gid://shopify/Product/2", label: "B" }];
    expect(storedFromDrafts("product_reference", [d({ refs: refs.slice(0, 1) }, "product_reference")]).value).toBe("gid://shopify/Product/1");
    expect(storedFromDrafts("product_reference", [d({ refs }, "product_reference")]).error).toBe("Pick only one item.");
    expect(storedFromDrafts("list.product_reference", [d({ refs }, "list.product_reference")]).value).toBe('["gid://shopify/Product/1","gid://shopify/Product/2"]');
    expect(storedFromDrafts("list.product_reference", [d({ refs: [] }, "list.product_reference")]).value).toBeNull();
  });
});

describe("draftsFromStored", () => {
  it("round-trips every editable type", () => {
    const cases: [string, string][] = [
      ["single_line_text_field", "Oak"],
      ["multi_line_text_field", "a\nb"],
      ["number_integer", "5"],
      ["number_decimal", "1.5"],
      ["boolean", "false"],
      ["date", "2026-01-02"],
      ["color", "#AABBCC"],
      ["url", "https://x.com"],
      ["dimension", '{"value":180,"unit":"cm"}'],
      ["weight", '{"value":2.5,"unit":"kg"}'],
      ["list.single_line_text_field", '["a","b"]'],
      ["list.number_integer", "[1,2,3]"],
      ["list.color", '["#AABBCC","#112233"]'],
      ["list.dimension", '[{"value":1,"unit":"cm"},{"value":2,"unit":"m"}]'],
      ["product_reference", "gid://shopify/Product/1"],
      ["list.collection_reference", '["gid://shopify/Collection/1","gid://shopify/Collection/2"]'],
    ];
    for (const [type, stored] of cases) {
      const drafts = draftsFromStored(type, stored);
      expect(storedFromDrafts(type, drafts).value, type).toBe(stored);
    }
  });
  it("missing value: one empty box, or no boxes for a list", () => {
    expect(draftsFromStored("single_line_text_field", null)).toHaveLength(1);
    expect(draftsFromStored("list.single_line_text_field", null)).toHaveLength(0);
    expect(draftsFromStored("list.product_reference", null)).toHaveLength(1);
  });
  it("uses the definition's rating scale", () => {
    const rules = [{ name: "scale_min", value: "0" }, { name: "scale_max", value: "10" }];
    expect(ratingScale(rules)).toEqual({ min: "0", max: "10" });
    expect(draftsFromStored("rating", '{"value":"7.0","scale_min":"0.0","scale_max":"10.0"}', rules)[0]).toMatchObject({ text: "7.0", ratingMin: "0", ratingMax: "10" });
  });
  it("uses names for references when known", () => {
    expect(draftsFromStored("product_reference", "gid://shopify/Product/1", [], { "gid://shopify/Product/1": "Oak table" })[0]!.refs[0]!.label).toBe("Oak table");
  });
});

describe("valueEditable", () => {
  it("is false for read-only types and for rich text with formatting the editor cannot keep", () => {
    expect(valueEditable("file_reference", "gid://shopify/MediaImage/1")).toBe(false);
    expect(valueEditable("single_line_text_field", "x")).toBe(true);
    const odd = JSON.stringify({ type: "root", children: [{ type: "code", children: [] }] });
    expect(valueEditable("rich_text_field", odd)).toBe(false);
  });
});
