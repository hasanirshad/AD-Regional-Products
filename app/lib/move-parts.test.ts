import { describe, expect, it } from "vitest";
import { planMove } from "./move";
import { makeShippers } from "./overview";
import { market, product, profile } from "./testkit";

const general = profile("general", [], { isDefault: true, restOfWorld: true });
const dhl = profile("dhl", ["DE"], { name: "DE-DHL" });
const uk = profile("uk", ["GB"], { name: "UK" });
const markets = [market("UK", ["GB"]), market("DE", ["DE"])];
const shippers = makeShippers([general, dhl, uk]);
const dhlShipper = shippers.find((s) => s.key === "dhl")!;

describe("planMove with split products", () => {
  const parts = { a: [{ key: "dhl", variants: 3 }, { key: "__general__", variants: 1 }], b: [{ key: "dhl", variants: 2 }] };
  const plan = planMove({
    products: [product("a", ["c-DE"], "ACTIVE", 4), product("b", ["c-DE"], "ACTIVE", 2)],
    membership: { a: "dhl", b: "dhl" },
    parts,
    target: dhlShipper,
    shippers,
    markets,
    mode: "full",
  });
  it("a product with only SOME variants in the target still has shipping to move", () => {
    const a = plan.lines.find((l) => l.product.id === "a")!;
    expect(a.shippingChange).toBe(true);
    expect(a.from).toBe("split: DE-DHL (3) + General (no profile) (1)");
  });
  it("a product wholly in the target has no shipping change", () => {
    expect(plan.lines.find((l) => l.product.id === "b")?.shippingChange ?? false).toBe(false);
  });
  it("warns that all variants of a split product move", () => {
    expect(plan.warnings.join(" ")).toMatch(/variants in different profiles/);
  });
  it("without parts a product is whole (old behaviour)", () => {
    const p = planMove({ products: [product("b", ["c-DE"])], membership: { b: "dhl" }, target: dhlShipper, shippers, markets, mode: "full" });
    expect(p.lines.find((l) => l.shippingChange)).toBeUndefined();
  });
});
