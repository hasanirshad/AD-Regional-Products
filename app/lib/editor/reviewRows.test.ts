import { describe, expect, it } from "vitest";
import { effective, putEdit, type EditMap } from "./edits";
import { baseOf } from "./doc";
import { fakeProduct, FakeShopify } from "./fake";
import { loadProductDoc } from "./load";
import { metafieldTranslationTarget, reviewCounts, reviewRows } from "./reviewRows";
import { targetKey, type Target } from "./model";
import type { OptionDraft } from "./optionsPlan";

const P = "gid://shopify/Product/1";

async function setup(extra = {}) {
  const shop = new FakeShopify([
    fakeProduct(P, {
      title: "Oak table",
      descriptionHtml: "<p>Solid oak</p>",
      productType: "Table",
      seoTitle: "Oak table SEO",
      metafields: { "custom.tag_line": { id: "gid://shopify/Metafield/7", type: "single_line_text_field", value: "Built to last" }, "custom.hero": { id: "gid://shopify/Metafield/8", type: "file_reference", value: "gid://shopify/MediaImage/1" } },
      ...extra,
    }),
  ]);
  shop.setTranslation(P, "title", "fr", "Table en chêne");
  shop.setTranslation(P, "body_html", "fr", "<p>Chêne massif</p>", true);
  const doc = await loadProductDoc(shop.gql, P, ["fr", "de"]);
  return { shop, doc };
}

const mfs = [
  { namespace: "custom", key: "tag_line", name: "Tag line", type: "single_line_text_field", step: "content" as const },
  { namespace: "custom", key: "hero", name: "Hero image", type: "file_reference", step: "files" as const },
  { namespace: "custom", key: "motto", name: "Motto", type: "single_line_text_field", step: "content" as const },
];

describe("reviewRows", () => {
  it("shows the main text next to one language, with status per text", async () => {
    const { doc } = await setup();
    const eff = (t: Target) => baseOf(doc, t);
    const rows = reviewRows({ doc, effectiveOf: eff, options: [], metafields: mfs }, "fr");
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by["p|title"]).toMatchObject({ primary: "Oak table", translation: "Table en chêne", status: "translated" });
    expect(by["p|body_html"]).toMatchObject({ status: "outdated", html: true });
    expect(by["p|product_type"]).toMatchObject({ status: "missing" });
    expect(by["p|meta_title"]).toMatchObject({ status: "missing" });
    expect(by["p|meta_description"]).toMatchObject({ status: "no-source" });
  });

  it("lists text metafields with a value, never files, and shows the handle as not translated", async () => {
    const { doc } = await setup();
    const rows = reviewRows({ doc, effectiveOf: (t) => baseOf(doc, t), options: [], metafields: mfs }, "fr");
    expect(rows.map((r) => r.key)).toContain("m|custom.tag_line");
    expect(rows.map((r) => r.key)).not.toContain("m|custom.hero");
    expect(rows.map((r) => r.key)).not.toContain("m|custom.motto"); // no value yet
    expect(rows.find((r) => r.key === "p|handle")).toMatchObject({ status: "not-translated", translation: null });
  });

  it("uses pending edits: a typed translation and a changed main text", async () => {
    const { doc } = await setup();
    let edits: EditMap = {};
    const fr: Target = { kind: "translation", productId: P, resourceId: P, resource: "product", field: "product_type", slot: "fr" };
    edits = putEdit(edits, fr, "Table", baseOf(doc, fr));
    const title: Target = { kind: "product", productId: P, field: "title" };
    edits = putEdit(edits, title, "Oak dining table", baseOf(doc, title));
    const eff = (t: Target) => effective(edits, t, baseOf(doc, t));
    const rows = reviewRows({ doc, effectiveOf: eff, options: [], metafields: [] }, "fr");
    expect(rows.find((r) => r.key === "p|product_type")).toMatchObject({ translation: "Table", status: "same" });
    expect(rows.find((r) => r.key === "p|title")!.primary).toBe("Oak dining table");
  });

  it("includes option names and values with the translations typed for this language", async () => {
    const { doc } = await setup();
    const options: OptionDraft[] = [{ name: "Size", tr: { fr: "Taille" }, values: [{ name: "S", tr: { fr: "P" } }, { name: "M", tr: {} }] }];
    const fr = reviewRows({ doc, effectiveOf: (t) => baseOf(doc, t), options, metafields: [] }, "fr").filter((r) => r.step === "variants");
    expect(fr.map((r) => [r.primary, r.translation, r.status])).toEqual([["Size", "Taille", "translated"], ["S", "P", "translated"], ["M", null, "missing"]]);
    const de = reviewRows({ doc, effectiveOf: (t) => baseOf(doc, t), options, metafields: [] }, "de").filter((r) => r.step === "variants");
    expect(de.every((r) => r.status === "missing")).toBe(true);
  });

  it("counts what is left to translate and ignores rows that are not translated", async () => {
    const { doc } = await setup();
    const rows = reviewRows({ doc, effectiveOf: (t) => baseOf(doc, t), options: [], metafields: mfs }, "fr");
    expect(reviewCounts(rows)).toEqual({ total: 5, ready: 1, missing: 3, outdated: 1, same: 0 });
  });
});

describe("metafieldTranslationTarget", () => {
  it("uses the saved metafield id, or a deferred target when the metafield has no value yet", async () => {
    const { doc } = await setup();
    const saved = metafieldTranslationTarget(doc, mfs[0]!, "fr");
    expect(saved.resourceId).toBe("gid://shopify/Metafield/7");
    expect(saved.defer).toBeUndefined();
    const later = metafieldTranslationTarget(doc, mfs[2]!, "fr");
    expect(later.defer).toEqual({ ownerId: P, namespace: "custom", key: "motto" });
    expect(later.resourceId.startsWith("defer:")).toBe(true);
    expect(targetKey(later)).not.toBe(targetKey(saved));
  });
});
