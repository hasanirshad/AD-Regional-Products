import { describe, expect, it } from "vitest";
import { planMove } from "./move";
import { findDrift, findMismatch, profileKeyOf, type ProductState } from "./readback";
import { makeShippers } from "./overview";
import { market, product, profile } from "./testkit";
import { GENERAL, NO_PROFILE } from "./keys";

const general = profile("general", [], { isDefault: true, restOfWorld: true });
const uk = profile("uk", ["GB"]);
const markets = [market("UK", ["GB"]), market("DE", ["DE"])];
const shippers = makeShippers([general, uk]);
const target = shippers.find((s) => s.key === "uk")!;

const planFor = (products = [product("a", ["c-DE"])], parts = undefined as undefined | Record<string, { key: string; variants: number }[]>) =>
  planMove({ products, membership: {}, parts, target, shippers, markets, mode: "full" });

const state = (over: Partial<ProductState> = {}): ProductState => ({
  id: "a",
  status: "ACTIVE",
  catalogIds: ["c-DE"],
  variants: [{ id: "v1", profileKey: GENERAL }],
  variantsComplete: true,
  ...over,
});

describe("profileKeyOf", () => {
  it("maps the default profile to General and a missing one to none", () => {
    expect(profileKeyOf({ id: "p", default: true })).toBe(GENERAL);
    expect(profileKeyOf({ id: "p", default: false })).toBe("p");
    expect(profileKeyOf(null)).toBe(NO_PROFILE);
  });
});

describe("findDrift (before Apply)", () => {
  const plan = planFor();
  it("is empty when the store still matches the review", () => {
    expect(findDrift(plan.lines, { a: state() })).toEqual([]);
  });
  it("catches a deleted product, a status change and changed catalogues", () => {
    expect(findDrift(plan.lines, {})[0]?.message).toMatch(/not found/);
    expect(findDrift(plan.lines, { a: state({ status: "DRAFT" }) })[0]?.message).toMatch(/Status changed/);
    expect(findDrift(plan.lines, { a: state({ catalogIds: [] }) })[0]?.message).toMatch(/catalogues changed/);
  });
  it("catches a product that was moved to another profile since the review", () => {
    const moved = state({ variants: [{ id: "v1", profileKey: "dhl" }] });
    expect(findDrift(plan.lines, { a: moved })[0]?.message).toMatch(/shipping profile changed/);
  });
  it("does not compare variants it could not count", () => {
    // membership says "dhl" but the variant count is unknown (capped read): no shipping drift is claimed
    const unknown = planMove({ products: [product("a", ["c-DE"])], membership: { a: "dhl" }, target, shippers, markets, mode: "full" });
    const moved = state({ variants: [{ id: "v1", profileKey: "uk" }] });
    expect(findDrift(unknown.lines, { a: moved }).filter((f) => /shipping/.test(f.message))).toEqual([]);
  });
});

describe("findMismatch (after Apply)", () => {
  const plan = planFor();
  const good = state({
    catalogIds: [],
    variants: [{ id: "v1", profileKey: "uk" }],
  });
  it("is empty when Shopify shows what was asked", () => {
    // moving to a UK-only profile unpublishes DE and (full mode) publishes UK
    const uk = plan.lines[0]!.changes.filter((c) => c.kind === "publish").map((c) => c.catalog.id);
    expect(findMismatch(plan.lines, { a: { ...good, catalogIds: uk } }, "uk", "uk")).toEqual([]);
  });
  it("catches variants that were silently left in the old profile", () => {
    const uk = plan.lines[0]!.changes.filter((c) => c.kind === "publish").map((c) => c.catalog.id);
    const out = findMismatch(plan.lines, { a: { ...good, catalogIds: uk, variants: [{ id: "v1", profileKey: GENERAL }, { id: "v2", profileKey: "uk" }] } }, "uk", "uk");
    expect(out[0]?.message).toMatch(/1 of 2 variants/);
  });
  it("catches a catalogue change that did not happen", () => {
    const out = findMismatch(plan.lines, { a: { ...good, catalogIds: ["c-DE"] } }, "uk", "uk");
    expect(out.map((o) => o.message).join(" ")).toMatch(/Still published in DE/);
    expect(out.map((o) => o.message).join(" ")).toMatch(/Not published in UK/);
  });
  it("reports a product it cannot read back", () => {
    expect(findMismatch(plan.lines, {}, "uk", "uk")[0]?.message).toMatch(/Could not read/);
  });
});
