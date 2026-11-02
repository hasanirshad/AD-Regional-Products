import { describe, expect, it } from "vitest";
import { fakeProduct, fakeVariant, FakeShopify } from "./fake";
import { loadOptionDrafts, optionProblems, optionsEngine, planIsEmpty, planOptions, reorderInput, sameOrder, hasOnlyDefaultOption, type OptionDraft } from "./optionsPlan";
import { loadProductDoc } from "./load";
import { createDraftProduct } from "./create";

const P = "gid://shopify/Product/1";
const hooks = { onProgress: () => {}, shouldStop: () => false, retryWaitMs: 0 } as never;
const o = (name: string, values: string[], extra: Partial<OptionDraft> = {}): OptionDraft => ({ name, tr: {}, values: values.map((v) => ({ name: v, tr: {} })), ...extra });

async function draftProduct() {
  const shop = new FakeShopify();
  const made = await createDraftProduct(shop.gql, { title: "Bed", descriptionHtml: "", vendor: "Hardman Design" });
  return { shop, id: made.id, handle: made.handle };
}

async function run(shop: FakeShopify, id: string, saved: OptionDraft[], draft: OptionDraft[]) {
  const plan = planOptions(saved, draft);
  let done = false;
  const engine = optionsEngine(shop.gql, { productId: id, title: "Bed", handle: "bed", saved, draft, plan }, () => (done = true));
  const findings = await engine.recheck(engine.lines);
  const { rows } = await engine.run(engine.lines, hooks);
  return { rows, findings, done, plan };
}

describe("hasOnlyDefaultOption", () => {
  it("recognises a product with no options of its own", () => {
    expect(hasOnlyDefaultOption([])).toBe(true);
    expect(hasOnlyDefaultOption([{ name: "Title", values: ["Default Title"] }])).toBe(true);
    expect(hasOnlyDefaultOption([{ name: "Size", values: ["S"] }])).toBe(false);
    expect(hasOnlyDefaultOption([{ name: "Title", values: ["A", "B"] }])).toBe(false);
  });
});

describe("optionProblems", () => {
  it("accepts good options and explains bad ones", () => {
    expect(optionProblems([o("Size", ["S", "M"])], [])).toEqual([]);
    expect(optionProblems([o("", ["S"])], []).join()).toMatch(/needs a name/);
    expect(optionProblems([o("Size", [])], []).join()).toMatch(/at least one value/);
    expect(optionProblems([o("Size", ["a", "A"])], []).join()).toMatch(/twice/);
    expect(optionProblems([o("Size", ["a"]), o("size", ["b"])], []).join()).toMatch(/listed twice/);
    expect(optionProblems([o("A", ["1"]), o("B", ["1"]), o("C", ["1"]), o("D", ["1"])], []).join()).toMatch(/3 options at most/);
    expect(optionProblems([o("A", Array.from({ length: 11 }, (_, i) => `a${i}`)), o("B", Array.from({ length: 11 }, (_, i) => `b${i}`))], []).join()).toMatch(/121 variants/);
  });
  it("does not allow removing a saved option or value", () => {
    const saved = [o("Size", ["S", "M"], { id: "o1" })];
    saved[0]!.values[0]!.id = "v1";
    saved[0]!.values[1]!.id = "v2";
    expect(optionProblems([], saved).join()).toMatch(/Removing an option/);
    const noM = [{ ...saved[0]!, values: [saved[0]!.values[0]!] }];
    expect(optionProblems(noM, saved).join()).toMatch(/Removing a value/);
  });
});

describe("planOptions", () => {
  it("creates everything in one call for a product without options", () => {
    const plan = planOptions([], [o("Size", ["S", "M"]), o("Colour", ["Oak"])]);
    expect(plan.createAll).toBe(true);
    expect(plan.variantsAfter).toBe(2);
    expect(plan.lines[0]).toMatch(/Create 2 options/);
  });
  it("lists translations of new options and values per language", () => {
    const draft = [o("Size", ["S"])];
    draft[0]!.tr = { fr: "Taille" };
    draft[0]!.values[0]!.tr = { fr: "P", de: "K" };
    const plan = planOptions([], draft);
    expect(plan.translations.map((t) => `${t.kind}:${t.slot}`).sort()).toEqual(["option:fr", "optionValue:de", "optionValue:fr"]);
  });
  it("is empty when nothing changed", () => {
    const saved = [o("Size", ["S"], { id: "o1" })];
    saved[0]!.values[0]!.id = "v1";
    expect(planIsEmpty(planOptions(saved, structuredClone(saved)))).toBe(true);
  });
  it("sees renames, added values, a reorder and a changed translation", () => {
    const saved = [o("Size", ["S", "M"], { id: "o1" }), o("Colour", ["Oak"], { id: "o2" })];
    saved[0]!.values[0]!.id = "v1";
    saved[0]!.values[1]!.id = "v2";
    saved[1]!.values[0]!.id = "v3";
    const draft = structuredClone(saved);
    draft[0]!.name = "Length";
    draft[0]!.values[1]!.name = "Medium";
    draft[0]!.values.push({ name: "L", tr: {} });
    draft.reverse();
    draft[1]!.tr = { fr: "Longueur" };
    const plan = planOptions(saved, draft);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ rename: "Length", addValues: ["L"] });
    expect(plan.updates[0]!.renameValues[0]).toMatchObject({ from: "M", name: "Medium" });
    expect(plan.reorder).toBe(true);
    expect(plan.translations).toHaveLength(1);
  });
  it("a new value placed before an old one counts as a reorder", () => {
    const saved = [o("Size", ["S"], { id: "o1" })];
    saved[0]!.values[0]!.id = "v1";
    const draft = structuredClone(saved);
    draft[0]!.values.unshift({ name: "XS", tr: {} });
    expect(planOptions(saved, draft).reorder).toBe(true);
  });
});

describe("reorder helpers", () => {
  const seen = [{ id: "o1", name: "Size", position: 1, values: [{ id: "a", name: "S" }, { id: "b", name: "M" }] }, { id: "o2", name: "Colour", position: 2, values: [{ id: "c", name: "Oak" }] }];
  it("matches by id, or by name for new things, and spots a different order", () => {
    const draft = [o("colour", ["Oak"]), o("Size", ["M", "S"])];
    expect(reorderInput(draft, seen)).toEqual([{ id: "o2", values: [{ id: "c" }] }, { id: "o1", values: [{ id: "b" }, { id: "a" }] }]);
    expect(sameOrder(draft, seen)).toBe(false);
    expect(sameOrder([o("Size", ["S", "M"]), o("Colour", ["Oak"])], seen)).toBe(true);
  });
});

describe("optionsEngine", () => {
  it("creates options and variants, then translations of names, and reads it all back", async () => {
    const { shop, id } = await draftProduct();
    const draft = [o("Size", ["S", "M"], { tr: { fr: "Taille" } }), o("Colour", ["Oak"])];
    draft[0]!.values[0]!.tr = { fr: "Petit" };
    const r = await run(shop, id, [], draft);
    expect(r.findings).toEqual([]);
    expect(r.rows.map((x) => x.status)).toEqual(["done", "done", "done", "done"]);
    expect(r.rows.at(-1)!.after).toBe("2 variants");
    expect(r.done).toBe(true);
    const p = shop.products.get(id)!;
    expect(p.options.map((x) => x.name)).toEqual(["Size", "Colour"]);
    expect(shop.translation(p.options[0]!.id!, "name", "fr")).toBe("Taille");
    expect(shop.translation(p.options[0]!.valueIds![0]!, "name", "fr")).toBe("Petit");
    expect(shop.count("EditorOptionsCreate")).toBe(1);
    expect(shop.count("EditorOptionsReorder")).toBe(0);
  });

  it("renames, adds a value, reorders and translates an existing option, keeping the variants", async () => {
    const { shop, id } = await draftProduct();
    await run(shop, id, [], [o("Size", ["S", "M"]), o("Colour", ["Oak", "Walnut"])]);
    const doc = await loadProductDoc(shop.gql, id, ["fr"]);
    const saved = await loadOptionDrafts(shop.gql, doc, ["fr"]);
    expect(saved.map((x) => x.name)).toEqual(["Size", "Colour"]);
    shop.products.get(id)!.variants[0]!.sku = "KEEP-ME";

    const draft = structuredClone(saved);
    draft[0]!.name = "Length";
    draft[0]!.values.push({ name: "L", tr: {} });
    draft[1]!.values.reverse();
    draft.reverse();
    draft[1]!.tr = { fr: "Longueur" };
    const r = await run(shop, id, saved, draft);
    expect(r.findings).toEqual([]);
    expect(r.rows.every((x) => x.status === "done")).toBe(true);
    const p = shop.products.get(id)!;
    expect(p.options.map((x) => `${x.name}:${x.values.join(",")}`)).toEqual(["Colour:Walnut,Oak", "Length:S,M,L"]);
    expect(p.variants).toHaveLength(6);
    expect(p.variants.filter((v) => v.sku === "KEEP-ME")).toHaveLength(1);
    expect(shop.translation(p.options[1]!.id!, "name", "fr")).toBe("Longueur");
    expect(shop.count("EditorOptionsReorder")).toBe(1);
  });

  it("stops at a failed structure step and writes no translations", async () => {
    const { shop, id } = await draftProduct();
    shop.failOn.set("EditorOptionsCreate", "Option name is taken");
    const draft = [o("Size", ["S"], { tr: { fr: "Taille" } })];
    const r = await run(shop, id, [], draft);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ status: "failed", message: expect.stringContaining("taken") });
    expect(r.done).toBe(false);
    expect(shop.count("EditorTranslationsRegister")).toBe(0);
  });

  it("is refused by the recheck when the options changed in Shopify since the review", async () => {
    const { shop, id } = await draftProduct();
    const plan = planOptions([], [o("Size", ["S"])]);
    await run(shop, id, [], [o("Colour", ["Oak"])]);
    const engine = optionsEngine(shop.gql, { productId: id, title: "Bed", handle: "bed", saved: [], draft: [o("Size", ["S"])], plan }, () => {});
    expect((await engine.recheck(engine.lines))[0]!.message).toMatch(/changed in Shopify/);
  });

  it("reports a translation that Shopify refused, with the structure still done", async () => {
    const { shop, id } = await draftProduct();
    shop.failOn.set("EditorTranslationsRegister", "Locale not enabled");
    const r = await run(shop, id, [], [o("Size", ["S"], { tr: { fr: "Taille" } })]);
    expect(r.rows[0]!.status).toBe("done");
    expect(r.rows.find((x) => x.title.includes("Translation"))).toMatchObject({ status: "failed" });
  });

  it("removes a translation that was cleared", async () => {
    const { shop, id } = await draftProduct();
    await run(shop, id, [], [o("Size", ["S"], { tr: { fr: "Taille" } })]);
    const doc = await loadProductDoc(shop.gql, id, ["fr"]);
    const saved = await loadOptionDrafts(shop.gql, doc, ["fr"]);
    expect(saved[0]!.tr.fr).toBe("Taille");
    const draft = structuredClone(saved);
    draft[0]!.tr = { fr: "" };
    const r = await run(shop, id, saved, draft);
    expect(r.rows.every((x) => x.status === "done")).toBe(true);
    expect(shop.translation(shop.products.get(id)!.options[0]!.id!, "name", "fr")).toBeUndefined();
  });

  it("says 'not verified' when Shopify answers ok but makes no variants", async () => {
    const { shop, id } = await draftProduct();
    shop.ignore.add("EditorOptionsCreate");
    const r = await run(shop, id, [], [o("Size", ["S", "M"])]);
    expect(r.rows.at(-1)).toMatchObject({ title: expect.stringContaining("Variants"), status: "not verified" });
  });
});

describe("a product that already has options is loaded as drafts with ids", () => {
  it("reads names, value ids and translations", async () => {
    const shop = new FakeShopify([fakeProduct(P, { options: [{ name: "Size", values: ["S", "M"] }], variants: [fakeVariant("v1")] })]);
    const doc = await loadProductDoc(shop.gql, P, ["fr"]);
    const drafts = await loadOptionDrafts(shop.gql, doc, ["fr"]);
    expect(drafts[0]!.values.map((v) => v.name)).toEqual(["S", "M"]);
    expect(drafts[0]!.id).toBeTruthy();
    expect(drafts[0]!.values.every((v) => v.id)).toBe(true);
  });
});

import { moveItem, parseValues, variantNames } from "./optionsPlan";

describe("editing helpers", () => {
  it("moves an item and clamps the target", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 99)).toEqual(["a", "c", "b"]);
    const same = ["a", "b"];
    expect(moveItem(same, 1, 1)).toBe(same);
    expect(moveItem(same, 5, 0)).toBe(same);
  });
  it("splits typed values, skipping empty and repeated ones", () => {
    expect(parseValues("S, M;L\n  XL ,, s", ["m"])).toEqual(["S", "L", "XL"]);
    expect(parseValues("")).toEqual([]);
  });
  it("names the variants the options make", () => {
    expect(variantNames([o("Colour", ["Oak", "Walnut"]), o("Size", ["S", "M"])])).toEqual(["Oak / S", "Oak / M", "Walnut / S", "Walnut / M"]);
    expect(variantNames([o("", ["x"]), o("Size", ["S", " "])])).toEqual(["S"]);
    expect(variantNames([])).toEqual([""]);
  });
});
