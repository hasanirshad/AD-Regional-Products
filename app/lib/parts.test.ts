import { describe, expect, it } from "vitest";
import { GENERAL } from "./keys";
import { buildParts, isSplit, partsOf } from "./parts";

const rows = [
  { id: "a", variantCount: 4 },
  { id: "b", variantCount: 2 },
  { id: "c", variantCount: 3 },
];

describe("buildParts", () => {
  it("a product wholly in one profile has one part", () => {
    const { membership, parts } = buildParts(rows, { a: [{ key: "dhl", variants: 4, capped: false }] });
    expect(membership).toEqual({ a: "dhl" });
    expect(parts.a).toEqual([{ key: "dhl", variants: 4 }]);
    expect(isSplit(parts.a!)).toBe(false);
  });
  it("variants outside every profile are in General, which makes the product split", () => {
    const { membership, parts } = buildParts(rows, { a: [{ key: "dhl", variants: 3, capped: false }] });
    expect(membership.a).toBe("dhl");
    expect(parts.a).toEqual([
      { key: "dhl", variants: 3 },
      { key: GENERAL, variants: 1 },
    ]);
    expect(isSplit(parts.a!)).toBe(true);
  });
  it("two profiles: the larger one is the primary", () => {
    const { membership, parts } = buildParts(rows, {
      b: [
        { key: "uk", variants: 1, capped: false },
        { key: "dhl", variants: 1, capped: false },
      ],
      a: [
        { key: "uk", variants: 1, capped: false },
        { key: "dhl", variants: 3, capped: false },
      ],
    });
    expect(membership).toEqual({ b: "uk", a: "dhl" });
    expect(parts.a?.map((p) => p.key)).toEqual(["dhl", "uk"]);
    expect(parts.b).toHaveLength(2);
  });
  it("a capped product is treated as whole (it cannot be counted)", () => {
    const { parts } = buildParts(rows, { c: [{ key: "dhl", variants: 250, capped: true }] });
    expect(parts.c).toEqual([{ key: "dhl", variants: 0 }]);
  });
  it("without variant counts nothing is reported as split", () => {
    const { parts } = buildParts(rows, { a: [{ key: "dhl", variants: 0, capped: false }] }, false);
    expect(parts.a).toEqual([{ key: "dhl", variants: 0 }]);
  });
  it("products in no profile are not listed", () => {
    expect(buildParts(rows, {}).parts).toEqual({});
  });
});

describe("partsOf", () => {
  it("falls back to membership, then General", () => {
    expect(partsOf("x", { x: "dhl" })).toEqual([{ key: "dhl", variants: 0 }]);
    expect(partsOf("y", {})).toEqual([{ key: GENERAL, variants: 0 }]);
    expect(partsOf("a", { a: "dhl" }, { a: [{ key: "dhl", variants: 1 }, { key: "uk", variants: 1 }] })).toHaveLength(2);
  });
});
