// The channel / catalogue write flow against a small fake of Shopify (real code, fake network).
import { beforeEach, describe, expect, it, vi } from "vitest";

const store: { pubs: Record<string, { status: string; pubs: string[] }>; ignore: boolean; failFor: string | null; calls: string[] } = {
  pubs: {},
  ignore: false,
  failFor: null,
  calls: [],
};

vi.mock("./admin", async (orig) => {
  const real = await orig<typeof import("./admin")>();
  return {
    ...real,
    adminGraphql: vi.fn(async (query: string, vars: Record<string, any>) => {
      if (query.includes("ReadbackPublications")) {
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const p = store.pubs[id];
            return p
              ? { id, status: p.status, resourcePublicationsV2: { pageInfo: { hasNextPage: false }, nodes: p.pubs.map((x) => ({ publication: { id: x } })) } }
              : null;
          }),
        };
      }
      const ids = ((vars.input ?? []) as { publicationId: string }[]).map((i) => i.publicationId);
      if (query.includes("publishablePublish")) {
        store.calls.push(`publish:${vars.id}:${ids.join(",")}`);
        if (store.failFor === vars.id) return { publishablePublish: { userErrors: [{ message: "nope" }] } };
        if (!store.ignore) store.pubs[vars.id]!.pubs = [...new Set([...store.pubs[vars.id]!.pubs, ...ids])];
        return { publishablePublish: { userErrors: [] } };
      }
      if (query.includes("publishableUnpublish")) {
        store.calls.push(`unpublish:${vars.id}:${ids.join(",")}`);
        if (!store.ignore) store.pubs[vars.id]!.pubs = store.pubs[vars.id]!.pubs.filter((x) => !ids.includes(x));
        return { publishableUnpublish: { userErrors: [] } };
      }
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    }),
  };
});

import { buildTargets, planPublish } from "./channels";
import { findPublishDrift, findPublishMismatch, publishEngine, recheckPublish } from "./publish";
import { readPublications } from "./readback";
import { market, product, profile } from "./testkit";

const { targets } = buildTargets({ channels: [{ id: "pub-online", name: "Online Store" }, { id: "pub-pos", name: "POS" }], markets: [market("DE", ["DE"])], hiddenMarkets: [] });
const hooks = { onProgress: () => {}, shouldStop: () => false, retryWaitMs: 0 };
const general = profile("general", ["DE"], { isDefault: true });

async function plan(ids: string[], choice: Record<string, "publish" | "unpublish">) {
  const states = await readPublications(ids);
  return planPublish({ products: ids.map((id) => product(id)), states, targets, choice, markets: [market("DE", ["DE"])], profiles: [general], membership: {} });
}

beforeEach(() => {
  store.ignore = false;
  store.failFor = null;
  store.calls = [];
  store.pubs = { a: { status: "ACTIVE", pubs: ["pub-online"] }, b: { status: "ACTIVE", pubs: ["pub-online", "pub-pos"] } };
});

describe("publish flow", () => {
  it("publishes and unpublishes in one call each, then confirms by reading back", async () => {
    const p = await plan(["a", "b"], { "pub-pos": "publish", "pub-c-DE": "publish", "pub-online": "unpublish" });
    const { rows } = await publishEngine(p).run(p.lines, hooks);
    expect(rows.map((r) => r.status)).toEqual(["done", "done"]);
    expect(store.calls).toContain("publish:a:pub-pos,pub-c-DE");
    expect(store.pubs.a!.pubs.sort()).toEqual(["pub-c-DE", "pub-pos"]);
    expect(rows[0]).toMatchObject({ handle: "handle-a", added: ["POS", "c-DE"], removed: ["Online Store"] });
    expect(rows[0]!.before).toBe("Published to: Online Store");
    expect(rows[0]!.after).toBe("Published to: POS, c-DE");
  });
  it("does not trust a silent no-op", async () => {
    const p = await plan(["a"], { "pub-pos": "publish" });
    store.ignore = true;
    const { rows } = await publishEngine(p).run(p.lines, hooks);
    expect(rows[0]!.status).toBe("not verified");
    expect(rows[0]!.message).toMatch(/Not published to POS/);
  });
  it("reports a failed product", async () => {
    const p = await plan(["a", "b"], { "pub-c-DE": "publish" });
    store.failFor = "a";
    const { rows } = await publishEngine(p).run(p.lines, hooks);
    expect(rows.map((r) => r.status)).toEqual(["failed", "done"]);
  });
  it("stopping leaves the rest untouched", async () => {
    const p = await plan(["a", "b"], { "pub-c-DE": "publish" });
    const { rows } = await publishEngine(p).run(p.lines, { ...hooks, shouldStop: () => true });
    expect(rows.every((r) => r.status === "not applied")).toBe(true);
    expect(store.calls).toEqual([]);
  });
  it("the first-product trial: a one-line run touches only that product", async () => {
    const p = await plan(["a", "b"], { "pub-c-DE": "publish" });
    await publishEngine(p).run(p.lines.slice(0, 1), hooks);
    expect(store.pubs.a!.pubs).toContain("pub-c-DE");
    expect(store.pubs.b!.pubs).not.toContain("pub-c-DE");
  });
});

describe("recheck", () => {
  it("is quiet when nothing changed, and catches a change made after the review", async () => {
    const p = await plan(["a"], { "pub-pos": "publish" });
    expect(await recheckPublish(p.lines)).toEqual([]);
    store.pubs.a!.pubs.push("pub-pos");
    expect((await recheckPublish(p.lines))[0]?.message).toMatch(/channels or catalogues changed/);
    expect(store.calls).toEqual([]);
  });
  it("catches a status change and a deleted product", async () => {
    const p = await plan(["a"], { "pub-pos": "publish" });
    expect(findPublishDrift(p.lines, { a: { id: "a", status: "DRAFT", publicationIds: ["pub-online"], complete: true } })[0]?.message).toMatch(/Status changed/);
    expect(findPublishDrift(p.lines, {})[0]?.message).toMatch(/not found/);
    expect(findPublishMismatch(p.lines, {})[0]?.message).toMatch(/Could not read/);
  });
});
