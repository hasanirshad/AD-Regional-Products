import { describe, expect, it } from "vitest";
import { returnsWords, shippingWords, withRules, type Data } from "./logic";

const node = (over: Record<string, unknown> = {}) => ({ id: "m1", ...over }) as never;

describe("shippingWords", () => {
  it("reads on, off, inherited and unknown", () => {
    expect(shippingWords(node({ delivery: { shipping: { isEnabled: true } } }))).toBe("On");
    expect(shippingWords(node({ delivery: { shipping: { isEnabled: false } } }))).toBe("Off");
    expect(shippingWords(node({ delivery: { shipping: null } }))).toBe("Inherited");
    expect(shippingWords(undefined)).toBeNull();
  });
});

describe("returnsWords", () => {
  it("covers the documented cases", () => {
    expect(returnsWords(node({ returnPolicyProfile: null }))).toBe("Store default");
    expect(returnsWords(node({ returnPolicyProfile: { name: "EU", returnRules: { canAcceptReturns: true, returnWindowDays: 30 } } }))).toBe("EU: 30 days");
    expect(returnsWords(node({ returnPolicyProfile: { name: null, returnRules: { canAcceptReturns: false } } }))).toBe("no returns");
    expect(returnsWords(node({ returnPolicyProfile: { returnRules: { canAcceptReturns: true, returnWindowDays: -1 } } }))).toBe("no time limit");
    expect(returnsWords(node({ returnPolicyProfile: { returnRules: null } }))).toBe("returns unrestricted");
    expect(returnsWords(undefined)).toBeNull();
  });
});

describe("withRules", () => {
  const def = { key: "DE", country: "DE", marketHandle: "de" } as never;
  const data = { productStatus: "ACTIVE", note: null, rows: [{ def, marketName: "Germany", marketStatus: "ACTIVE", state: "published", price: null }] } as unknown as Data;
  const markets = [{ id: "m1", name: "Germany", handle: "de" }] as never;
  it("adds words per market and leaves null when a query failed", () => {
    const ship = { markets: { nodes: [{ id: "m1", delivery: { shipping: { isEnabled: true } } }] } };
    const out = withRules(data, markets, ship as never, null);
    expect(out.rows[0]!.shipping).toBe("On");
    expect(out.rows[0]!.returns).toBeNull();
  });
});
