import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let mode: "driven" | "profiles" | "null" | "fail" = "profiles";

vi.mock("./admin", async (orig) => {
  const real = await orig<typeof import("./admin")>();
  return {
    ...real,
    adminGraphql: vi.fn(async (query: string) => {
      calls.push(query.includes("mutation") ? "mutation" : query.includes("ShippingMode") ? "mode" : "other");
      if (query.includes("ShippingMode")) {
        if (mode === "fail") throw new Error("field not found");
        return { shop: { features: { marketDrivenShipping: mode === "null" ? null : mode === "driven" } } };
      }
      throw new Error("unexpected query");
    }),
  };
});

import { runCountryFix } from "./fix";
import { MARKET_DRIVEN_MESSAGE, assertProfilesAreLive, readShippingMode } from "./shippingMode";
import { applyMove } from "./applyMove";

beforeEach(() => {
  calls.length = 0;
  mode = "profiles";
});

describe("readShippingMode", () => {
  it("says market-driven, profiles or unknown", async () => {
    mode = "driven";
    expect(await readShippingMode()).toBe("market-driven");
    mode = "profiles";
    expect(await readShippingMode()).toBe("profiles");
    mode = "null";
    expect(await readShippingMode()).toBe("unknown");
  });
  it("is unknown (not blocking) when the field cannot be read", async () => {
    mode = "fail";
    expect(await readShippingMode()).toBe("unknown");
    await expect(assertProfilesAreLive()).resolves.toBeUndefined();
  });
});

describe("writes stop on a market-driven shop", () => {
  const plan = { target: { profile: { id: "gid://shopify/DeliveryProfile/1" } }, lines: [{ shippingChange: true, product: { id: "p1", title: "A" } }] } as never;
  it("applyMove refuses before any query or mutation", async () => {
    mode = "driven";
    await expect(applyMove(plan, { onProgress: () => {}, shouldStop: () => false })).rejects.toThrow(MARKET_DRIVEN_MESSAGE);
    expect(calls).toEqual(["mode"]);
  });
  it("runCountryFix refuses before any read or write", async () => {
    mode = "driven";
    const fix = { add: ["DE"], zone: { id: "z", countries: [], locationGroupId: "g" } } as never;
    await expect(runCountryFix("gid://shopify/DeliveryProfile/1", fix)).rejects.toThrow(/market-driven/);
    expect(calls).toEqual(["mode"]);
  });
});
