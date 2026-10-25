// The write flow against a small fake of Shopify: the real applyMove / runPlan code runs,
// only the network call is replaced. This is the contract test the app never had.
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeVariant = { id: string; profile: { id: string; default: boolean } | null };
type FakeProduct = { id: string; status: string; catalogIds: string[]; variants: FakeVariant[] };

const store: { products: Record<string, FakeProduct>; ignoreAssociate: boolean; failPublishFor: string | null; log: string[] } = {
  products: {},
  ignoreAssociate: false,
  failPublishFor: null,
  log: [],
};

vi.mock("./admin", async (orig) => {
  const real = await orig<typeof import("./admin")>();
  return {
    ...real,
    adminGraphql: vi.fn(async (query: string, vars: Record<string, any>) => {
      const isMutation = query.includes("mutation");
      if (query.includes("ReadbackCatalogs")) {
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const p = store.products[id];
            if (!p) return null;
            return {
              id,
              status: p.status,
              resourcePublicationsV2: { nodes: p.catalogIds.map((c) => ({ publication: { catalog: { id: c } } })) },
            };
          }),
        };
      }
      if (query.includes("ReadbackVariants")) {
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const p = store.products[id];
            return p
              ? { id, variants: { pageInfo: { hasNextPage: false }, nodes: p.variants.map((v) => ({ id: v.id, deliveryProfile: v.profile })) } }
              : null;
          }),
        };
      }
      if (!isMutation && query.includes("MoveVariants")) {
        return {
          nodes: (vars.ids as string[]).map((id) => {
            const p = store.products[id];
            return p ? { id, variants: { pageInfo: { hasNextPage: false }, nodes: p.variants.map((v) => ({ id: v.id })) } } : null;
          }),
        };
      }
      if (isMutation && query.includes("deliveryProfileUpdate")) {
        store.log.push(`associate:${(vars.profile.variantsToAssociate as string[]).join(",")}`);
        if (!store.ignoreAssociate) {
          for (const p of Object.values(store.products))
            for (const v of p.variants) if ((vars.profile.variantsToAssociate as string[]).includes(v.id)) v.profile = { id: vars.id, default: false };
        }
        return { deliveryProfileUpdate: { userErrors: [] } };
      }
      if (isMutation && (query.includes("publishablePublish") || query.includes("publishableUnpublish"))) {
        const p = store.products[vars.id];
        const cats = (vars.input as { publicationId: string }[]).map((i) => i.publicationId.replace("pub-", ""));
        if (query.includes("publishablePublish")) {
          if (store.failPublishFor === vars.id) return { publishablePublish: { userErrors: [{ message: "nope" }] } };
          if (p) p.catalogIds = [...new Set([...p.catalogIds, ...cats])];
          return { publishablePublish: { userErrors: [] } };
        }
        if (p) p.catalogIds = p.catalogIds.filter((c) => !cats.includes(c));
        return { publishableUnpublish: { userErrors: [] } };
      }
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    }),
  };
});

import { PRODUCTS_PER_READ, VARIANTS_PER_READ } from "./applyMove";
import { GENERAL } from "./keys";
import { planMove } from "./move";
import { makeShippers } from "./overview";
import { recheckPlan, runPlan, subPlan } from "./runPlan";
import { market, product, profile } from "./testkit";

const general = profile("general", [], { isDefault: true, restOfWorld: true });
const uk = profile("uk", ["GB"]);
const markets = [market("UK", ["GB"]), market("DE", ["DE"])];
const shippers = makeShippers([general, uk]);
const target = shippers.find((s) => s.key === "uk")!;

const seed = (id: string, catalogIds: string[]) => {
  store.products[id] = { id, status: "ACTIVE", catalogIds, variants: [{ id: `${id}-v1`, profile: { id: "general", default: true } }, { id: `${id}-v2`, profile: { id: "general", default: true } }] };
};
const plan = (ids: string[]) =>
  planMove({ products: ids.map((id) => product(id, store.products[id]!.catalogIds, "ACTIVE", 2)), membership: {}, target, shippers, markets, mode: "full" });
const options = { onProgress: () => {}, shouldStop: () => false, retryWaitMs: 0 };

beforeEach(() => {
  store.products = {};
  store.ignoreAssociate = false;
  store.failPublishFor = null;
  store.log = [];
  seed("a", ["c-DE"]);
  seed("b", ["c-DE"]);
});

describe("cost of the variant read", () => {
  it("stays under Shopify's 1,000 limit (5 products x 250 variants was over it)", () => {
    expect(PRODUCTS_PER_READ * VARIANTS_PER_READ + PRODUCTS_PER_READ * 2).toBeLessThan(1000);
    expect(5 * VARIANTS_PER_READ).toBeGreaterThan(1000);
  });
});

describe("runPlan", () => {
  it("moves the product, changes its catalogues, and confirms it by reading it back", async () => {
    const out = await runPlan(plan(["a", "b"]), options);
    expect(out.rows.map((r) => r.status)).toEqual(["done", "done"]);
    expect(out.allVerified).toBe(true);
    expect(store.products.a!.variants.every((v) => v.profile?.id === "uk")).toBe(true);
    expect(store.products.a!.catalogIds).toEqual(["c-UK"]);
    expect(out.rows[0]).toMatchObject({ handle: "handle-a", added: ["UK: c-UK"], removed: ["DE: c-DE"] });
    expect(out.rows[0]!.before).toContain("General");
    expect(out.rows[0]!.after).toContain("Profile: uk");
  });

  it("does not trust a silent no-op: Shopify says ok but nothing moved", async () => {
    store.ignoreAssociate = true;
    const out = await runPlan(plan(["a"]), options);
    expect(out.rows[0]!.status).toBe("not verified");
    expect(out.rows[0]!.message).toMatch(/still shows 2 of 2 variants/);
    expect(out.allVerified).toBe(false);
  });

  it("reports a failed product and leaves its catalogues alone", async () => {
    store.failPublishFor = "a";
    const out = await runPlan(plan(["a", "b"]), options);
    expect(out.rows.find((r) => r.productId === "a")!.status).toBe("failed");
    expect(out.rows.find((r) => r.productId === "b")!.status).toBe("done");
  });

  it("the first-product trial: a one-line plan touches only that product", async () => {
    const p = plan(["a", "b"]);
    const out = await runPlan(subPlan(p, p.lines.slice(0, 1)), options);
    expect(out.rows).toHaveLength(1);
    expect(store.products.a!.variants[0]!.profile?.id).toBe("uk");
    expect(store.products.b!.variants[0]!.profile?.id).toBe("general");
    expect(store.products.b!.catalogIds).toEqual(["c-DE"]);
  });

  it("stopping marks the untouched products as not applied", async () => {
    const out = await runPlan(plan(["a", "b"]), { ...options, shouldStop: () => true });
    expect(out.rows.every((r) => r.status === "not applied")).toBe(true);
    expect(store.log).toEqual([]);
  });
});

describe("recheckPlan", () => {
  it("is quiet when the store matches the review", async () => {
    expect(await recheckPlan(plan(["a", "b"]))).toEqual([]);
  });
  it("catches a catalogue change made after the review, before anything is written", async () => {
    const p = plan(["a"]);
    store.products.a!.catalogIds = [];
    const found = await recheckPlan(p);
    expect(found[0]?.message).toMatch(/catalogues changed/);
    expect(store.log).toEqual([]);
  });
  it("catches a product moved to another profile after the review", async () => {
    const p = plan(["a"]);
    store.products.a!.variants.forEach((v) => (v.profile = { id: "dhl", default: false }));
    expect((await recheckPlan(p))[0]?.message).toMatch(/shipping profile changed/);
  });
});

describe("General key", () => {
  it("is the same one the readback uses", () => {
    expect(GENERAL).toBe("__general__");
  });
});
