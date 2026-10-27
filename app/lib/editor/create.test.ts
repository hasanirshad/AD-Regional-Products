import { describe, expect, it } from "vitest";
import { combinations, createDraftProduct, createEngine, nextStep, newProductProblem, optionsEngine, optionsProblem, variantCount } from "./create";
import { FakeShopify } from "./fake";
import { CREATE_STEPS, listDrafts, parseDraftState } from "./settings";

const hooks = { onProgress: () => {}, shouldStop: () => false, retryWaitMs: 0 } as never;

describe("newProductProblem", () => {
  it("needs a title", () => {
    expect(newProductProblem({ title: "  ", descriptionHtml: "", vendor: "" })).toContain("title");
    expect(newProductProblem({ title: "Table", descriptionHtml: "", vendor: "" })).toBeNull();
  });
});

describe("createDraftProduct", () => {
  it("always makes a DRAFT, whatever else is typed", async () => {
    const shop = new FakeShopify();
    const made = await createDraftProduct(shop.gql, { title: "Oak table", descriptionHtml: "<p>Nice</p>", vendor: "Hardman" });
    expect(shop.products.get(made.id)!.status).toBe("DRAFT");
    expect((shop.calls[0]!.variables.product as { status: string }).status).toBe("DRAFT");
  });

  it("throws Shopify's message when it refuses", async () => {
    const shop = new FakeShopify();
    shop.failOn.set("EditorProductCreate", "Title can't be blank");
    await expect(createDraftProduct(shop.gql, { title: "x", descriptionHtml: "", vendor: "" })).rejects.toThrow("Title can't be blank");
  });
});

describe("createEngine", () => {
  it("creates the draft, saves the step reached, reads it back and hands over the new id", async () => {
    const shop = new FakeShopify();
    let created = "";
    const engine = createEngine({ gql: shop.gql, product: { title: "Oak table", descriptionHtml: "", vendor: "" }, rows: { product: ["custom.material"], variant: [] }, onCreated: (id) => (created = id) });
    const { rows } = await engine.run(engine.lines, hooks);
    expect(rows[0]!.status).toBe("done");
    expect(created).not.toBe("");
    const state = parseDraftState(shop.appData.get(created)!.get("draft_state"));
    expect(state).toMatchObject({ step: "seo", product: ["custom.material"] });
  });

  it("reports a failure without handing over an id", async () => {
    const shop = new FakeShopify();
    shop.failOn.set("EditorProductCreate", "Nope");
    let created = "";
    const engine = createEngine({ gql: shop.gql, product: { title: "x", descriptionHtml: "", vendor: "" }, rows: { product: [], variant: [] }, onCreated: (id) => (created = id) });
    const { rows } = await engine.run(engine.lines, hooks);
    expect(rows[0]!.status).toBe("failed");
    expect(created).toBe("");
  });

  it("still succeeds when only the 'continue later' note could not be saved, and says so", async () => {
    const shop = new FakeShopify();
    shop.failOn.set("EditorSaveSetting", "Not allowed");
    const engine = createEngine({ gql: shop.gql, product: { title: "x", descriptionHtml: "", vendor: "" }, rows: { product: [], variant: [] }, onCreated: () => {} });
    const { rows } = await engine.run(engine.lines, hooks);
    expect(rows[0]!.status).toBe("done");
    expect(rows[0]!.message).toContain("could not be saved");
  });
});

describe("unfinished drafts", () => {
  it("lists only draft products that carry a saved step", async () => {
    const shop = new FakeShopify();
    const a = await createDraftProduct(shop.gql, { title: "A", descriptionHtml: "", vendor: "" });
    await createDraftProduct(shop.gql, { title: "B (made elsewhere)", descriptionHtml: "", vendor: "" });
    shop.appData.set(a.id, new Map([["draft_state", JSON.stringify({ version: 1, step: "tags", product: [], variant: [], savedAt: "t" })]]));
    const drafts = await listDrafts(shop.gql);
    expect(drafts.map((d) => d.title)).toEqual(["A"]);
    expect(drafts[0]!.state.step).toBe("tags");
  });
});

describe("steps", () => {
  it("moves to the next step and stays on the last", () => {
    expect(nextStep(CREATE_STEPS, "basics")).toBe("seo");
    expect(nextStep(CREATE_STEPS, "prices")).toBe("prices");
  });
});

describe("options", () => {
  it("counts and lists the combinations", () => {
    const o = [
      { name: "Size", values: ["S", "M"] },
      { name: "Wood", values: ["Oak", "Ash", "Pine"] },
    ];
    expect(variantCount(o)).toBe(6);
    expect(combinations(o)).toHaveLength(6);
    expect(combinations(o)[0]).toEqual(["S", "Oak"]);
  });

  it("explains what is wrong", () => {
    expect(optionsProblem([])).toContain("at least one option");
    expect(optionsProblem([{ name: "", values: ["a"] }])).toContain("needs a name");
    expect(optionsProblem([{ name: "Size", values: [] }])).toContain("at least one value");
    expect(optionsProblem([{ name: "Size", values: ["a", "A"] }])).toContain("same value twice");
    expect(optionsProblem([{ name: "Size", values: ["a"] }, { name: "size", values: ["b"] }])).toContain("listed twice");
    expect(optionsProblem([{ name: "A", values: Array.from({ length: 11 }, (_, i) => `a${i}`) }, { name: "B", values: Array.from({ length: 11 }, (_, i) => `b${i}`) }])).toContain("121 variants");
    expect(optionsProblem([{ name: "Size", values: ["S", "M"] }])).toBeNull();
  });

  it("adds options, checks the variant count by reading the product back", async () => {
    const shop = new FakeShopify();
    const made = await createDraftProduct(shop.gql, { title: "A", descriptionHtml: "", vendor: "" });
    let done = false;
    const engine = optionsEngine(shop.gql, { productId: made.id, title: "A", handle: made.handle, options: [{ name: "Size", values: ["S", "M"] }] }, () => (done = true));
    expect(await engine.recheck(engine.lines)).toEqual([]);
    const { rows } = await engine.run(engine.lines, hooks);
    expect(rows[0]!.status).toBe("done");
    expect(rows[0]!.after).toBe("2 variants");
    expect(done).toBe(true);
    // The product now has options, so a second run is refused by the recheck.
    expect((await engine.recheck(engine.lines))[0]!.message).toContain("already has options");
  });

  it("says 'not verified' when Shopify answers ok but makes no variants", async () => {
    const shop = new FakeShopify();
    const made = await createDraftProduct(shop.gql, { title: "A", descriptionHtml: "", vendor: "" });
    shop.ignore.add("EditorOptionsCreate");
    const engine = optionsEngine(shop.gql, { productId: made.id, title: "A", handle: made.handle, options: [{ name: "Size", values: ["S", "M"] }] }, () => {});
    const { rows } = await engine.run(engine.lines, hooks);
    expect(rows[0]!.status).toBe("not verified");
  });
});
