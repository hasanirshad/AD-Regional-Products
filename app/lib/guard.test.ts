import { describe, expect, it } from "vitest";
import { adminGraphql } from "./admin";
import { assertUnlocked, checkPassword, isMutation, isUnlocked, PASSWORD_SHA256, runUnlocked, sha256Hex } from "./guard";

const okFetch = async () => ({ status: 200, ok: true, json: async () => ({ data: { ok: true } }) });

describe("password", () => {
  it("accepts only the right password", async () => {
    expect(await checkPassword("appsdapps")).toBe(true);
    expect(await checkPassword("Appsdapps")).toBe(false);
    expect(await checkPassword("")).toBe(false);
  });
  it("stores the hash, not the password", async () => {
    expect(PASSWORD_SHA256).toBe(await sha256Hex("appsdapps"));
    expect(PASSWORD_SHA256).not.toContain("appsdapps");
  });
});

describe("isMutation", () => {
  it("spots mutations, also behind a #graphql comment, and ignores queries", () => {
    expect(isMutation("#graphql\n  mutation X { a }")).toBe(true);
    expect(isMutation("mutation($id: ID!) { a }")).toBe(true);
    expect(isMutation("#graphql\n  query X { a }")).toBe(false);
    expect(isMutation("{ shop { name } }")).toBe(false);
  });
});

describe("write lock", () => {
  it("blocks mutations until unlocked, and locks again afterwards", async () => {
    await expect(adminGraphql("mutation M { a }", {}, { fetcher: okFetch })).rejects.toThrow(/password/);
    await runUnlocked(async () => {
      expect(isUnlocked()).toBe(true);
      await expect(adminGraphql("mutation M { a }", {}, { fetcher: okFetch })).resolves.toEqual({ ok: true });
    });
    expect(isUnlocked()).toBe(false);
    expect(() => assertUnlocked()).toThrow();
  });
  it("never blocks reads", async () => {
    await expect(adminGraphql("query Q { a }", {}, { fetcher: okFetch })).resolves.toEqual({ ok: true });
  });
  it("locks again even when the action throws", async () => {
    await expect(runUnlocked(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(isUnlocked()).toBe(false);
  });
});
