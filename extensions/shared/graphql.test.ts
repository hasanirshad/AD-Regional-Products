import { describe, expect, it } from "vitest";
import { aliasOf, BlockError, countryEnum, explain, localeLiteral, makeQueries, type RawQuery } from "./graphql";

const noWait = async () => {};

describe("makeQueries", () => {
  it("returns data", async () => {
    const { q } = makeQueries(async () => ({ data: { a: 1 } }), noWait);
    expect(await q("query X { a }")).toEqual({ a: 1 });
  });

  it("refuses a mutation without calling Shopify", async () => {
    let called = false;
    const { q } = makeQueries(async () => {
      called = true;
      return { data: {} };
    }, noWait);
    await expect(q("mutation Bad { x }")).rejects.toThrow(/read only/);
    expect(called).toBe(false);
  });

  it("retries a throttled answer, then succeeds", async () => {
    let n = 0;
    const raw: RawQuery = async () => (++n < 3 ? { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } : { data: { ok: true } });
    const { q } = makeQueries(raw, noWait);
    expect(await q("query X { ok }")).toEqual({ ok: true });
    expect(n).toBe(3);
  });

  it("gives up on throttling after three tries with a plain message", async () => {
    const raw: RawQuery = async () => ({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] });
    const { q } = makeQueries(raw, noWait);
    await expect(q("query X { ok }")).rejects.toMatchObject({ kind: "throttled" });
  });

  it("turns a missing permission into a message that names it", async () => {
    const raw: RawQuery = async () => ({ errors: [{ message: "Access denied for translatableResource field. Required access: `read_translations` access scope.", extensions: { code: "ACCESS_DENIED" } }] });
    const { q } = makeQueries(raw, noWait);
    const err = (await q("query X { a }").catch((e: unknown) => e)) as BlockError;
    expect(err.kind).toBe("access");
    expect(err.message).toContain("read_translations");
    expect(err.message).toMatch(/store owner/);
  });

  it("reports a network failure", async () => {
    const { q } = makeQueries(async () => {
      throw new Error("offline");
    }, noWait);
    await expect(q("query X { a }")).rejects.toMatchObject({ kind: "network" });
  });

  it("classifies validation errors as schema errors", () => {
    expect(explain([{ message: "Field 'contextualPricing' doesn't exist on type 'Product'", extensions: { code: "undefinedField" } }]).kind).toBe("schema");
    expect(explain([{ message: "Argument 'context' on Field 'contextualPricing' has an invalid value" }]).kind).toBe("schema");
    expect(explain([{ message: "Something else" }]).kind).toBe("graphql");
  });

  it("soft returns the error instead of throwing", async () => {
    const { soft } = makeQueries(async () => ({ data: { a: 1 }, errors: [{ message: "partial" }] }), noWait);
    const r = await soft<{ a: number }>("query X { a }");
    expect(r.data).toEqual({ a: 1 });
    expect(r.error?.kind).toBe("graphql");
  });
});

describe("constants guards", () => {
  it("accepts only real country and locale codes", () => {
    expect(countryEnum("GB")).toBe("GB");
    expect(() => countryEnum("gb")).toThrow();
    expect(() => countryEnum("GB) { x }")).toThrow();
    expect(localeLiteral("pt-BR")).toBe('"pt-BR"');
    expect(() => localeLiteral('fr"){')).toThrow();
    expect(aliasOf("pt-BR")).toBe("pt_BR");
  });
});
