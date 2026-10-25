import { describe, expect, it } from "vitest";
import { normalizeBase, readOverrides, writeOverrides } from "./domains";

describe("normalizeBase", () => {
  it("adds https and removes a trailing slash", () => {
    expect(normalizeBase("hardman.de")).toEqual({ ok: true, value: "https://hardman.de" });
    expect(normalizeBase(" https://hardman.de/ ")).toEqual({ ok: true, value: "https://hardman.de" });
    expect(normalizeBase("HTTP://Shop.Hardman.com")).toEqual({ ok: true, value: "http://shop.hardman.com" });
  });
  it("keeps a subfolder", () => {
    expect(normalizeBase("hardman.com/fr/")).toEqual({ ok: true, value: "https://hardman.com/fr" });
  });
  it("an empty field clears the setting", () => {
    expect(normalizeBase("  ")).toEqual({ ok: true, value: "" });
  });
  it("rejects what is not a base address", () => {
    expect(normalizeBase("not a domain").ok).toBe(false);
    expect(normalizeBase("localhost").ok).toBe(false);
    expect(normalizeBase("https://hardman.de/products/oak").ok).toBe(false);
    expect(normalizeBase("https://hardman.de/?x=1").ok).toBe(false);
  });
});

describe("saved overrides", () => {
  const fake = () => {
    const data: Record<string, string> = {};
    return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
  };
  it("round-trips and ignores junk", () => {
    const s = fake();
    expect(writeOverrides({ m1: "https://hardman.de" }, s)).toBe(true);
    expect(readOverrides(s)).toEqual({ m1: "https://hardman.de" });
    s.setItem("ad-regional-products:market-domains", "{bad");
    expect(readOverrides(s)).toEqual({});
  });
  it("says so when the browser will not save", () => {
    expect(writeOverrides({ a: "b" }, { setItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(writeOverrides({ a: "b" }, null)).toBe(false);
    expect(readOverrides(null)).toEqual({});
  });
});
