import { describe, expect, it } from "vitest";
import { checkRules, choicesOf } from "./mfRules";

const v = (name: string, value: string) => ({ name, value });

describe("choices", () => {
  const rules = [v("choices", '["Oak","Pine"]')];
  it("reads the allowed choices", () => {
    expect(choicesOf(rules)).toEqual(["Oak", "Pine"]);
    expect(choicesOf([])).toBeNull();
    expect(choicesOf([v("choices", "not json")])).toBeNull();
  });
  it("rejects a value that is not a choice", () => {
    expect(checkRules("single_line_text_field", rules, "Oak")).toBeNull();
    expect(checkRules("single_line_text_field", rules, "Teak")).toMatch(/allowed choices/);
  });
  it("checks every item of a list", () => {
    expect(checkRules("list.single_line_text_field", rules, '["Oak","Pine"]')).toBeNull();
    expect(checkRules("list.single_line_text_field", rules, '["Oak","Teak"]')).toMatch(/Teak/);
  });
});

describe("text rules", () => {
  it("checks length and pattern", () => {
    const rules = [v("min", "3"), v("max", "5"), v("regex", "^[A-Z]+$")];
    expect(checkRules("single_line_text_field", rules, "ABCD")).toBeNull();
    expect(checkRules("single_line_text_field", rules, "AB")).toMatch(/at least 3/);
    expect(checkRules("single_line_text_field", rules, "ABCDEF")).toMatch(/at most 5/);
    expect(checkRules("single_line_text_field", rules, "abcd")).toMatch(/pattern/);
  });
  it("counts characters, not bytes", () => {
    expect(checkRules("single_line_text_field", [v("max", "2")], "😀😀")).toBeNull();
  });
  it("ignores a pattern it cannot read", () => {
    expect(checkRules("single_line_text_field", [v("regex", "(")], "x")).toBeNull();
  });
});

describe("number rules", () => {
  it("checks minimum, maximum and decimal places", () => {
    const rules = [v("min", "1"), v("max", "10"), v("max_precision", "2")];
    expect(checkRules("number_decimal", rules, "9.99")).toBeNull();
    expect(checkRules("number_decimal", rules, "0.5")).toMatch(/at least 1/);
    expect(checkRules("number_decimal", rules, "11")).toMatch(/at most 10/);
    expect(checkRules("number_decimal", rules, "1.234")).toMatch(/2 decimal/);
    expect(checkRules("number_integer", [v("max", "5")], "6")).toMatch(/at most 5/);
  });
});

describe("other rules", () => {
  it("checks the domain of a URL, including subdomains", () => {
    const rules = [v("allowed_domains", '["example.com"]')];
    expect(checkRules("url", rules, "https://example.com/a")).toBeNull();
    expect(checkRules("url", rules, "https://shop.example.com/a")).toBeNull();
    expect(checkRules("url", rules, "https://badexample.com/a")).toMatch(/domains/);
  });
  it("checks date ranges", () => {
    const rules = [v("min", "2026-01-01"), v("max", "2026-12-31")];
    expect(checkRules("date", rules, "2026-06-01")).toBeNull();
    expect(checkRules("date", rules, "2025-12-31")).toMatch(/on or after/);
    expect(checkRules("date", rules, "2027-01-01")).toMatch(/on or before/);
  });
  it("checks list length", () => {
    const rules = [v("list.min", "2"), v("list.max", "3")];
    expect(checkRules("list.single_line_text_field", rules, '["a"]')).toMatch(/at least 2/);
    expect(checkRules("list.single_line_text_field", rules, '["a","b","c","d"]')).toMatch(/at most 3/);
    expect(checkRules("list.single_line_text_field", rules, '["a","b"]')).toBeNull();
  });
  it("leaves types it does not cover to Shopify", () => {
    expect(checkRules("money", [v("min", "1")], '{"amount":"0.5","currency_code":"USD"}')).toBeNull();
    expect(checkRules("single_line_text_field", [v("max", "1")], null)).toBeNull();
  });
});
