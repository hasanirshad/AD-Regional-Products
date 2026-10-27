import { describe, expect, it } from "vitest";
import { applyBundle, productInput, splitChanges, variantInputs } from "./apply";
import { tagsToValue } from "./canon";
import { baseOf, type ProductDoc } from "./doc";
import { fakeProduct, fakeVariant, FakeShopify, LOC_A } from "./fake";
import { loadProductDoc } from "./load";
import { targetKey, type Bundle, type Change, type Target, type Value } from "./model";

const P = "gid://shopify/Product/1";
const V = "gid://shopify/ProductVariant/11";

function setup() {
  const mf = { id: "gid://shopify/Metafield/5", type: "single_line_text_field", value: "Oak" };
  const shop = new FakeShopify([
    fakeProduct(P, {
      title: "Table",
      handle: "table",
      seoTitle: "Table SEO",
      metafields: { "custom.material": mf },
      variants: [fakeVariant(V, { price: "100.00", sku: "T-1", levels: { [LOC_A]: 5 } })],
    }),
  ]);
  return { shop };
}

const change = (doc: ProductDoc, target: Target, after: Value, label = "x"): Change => ({
  id: targetKey(target),
  target,
  productId: P,
  productTitle: doc.title,
  label,
  tab: "basic",
  before: baseOf(doc, target),
  after,
});

const bundle = (changes: Change[]): Bundle => ({ productId: P, title: "Table", handle: "table", changes });

describe("inputs", () => {
  it("sends only the changed product fields, and seo as one object", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, ["fr"]);
    const c = [
      change(doc, { kind: "product", productId: P, field: "title" }, "New table"),
      change(doc, { kind: "product", productId: P, field: "seoTitle" }, "New SEO"),
      change(doc, { kind: "product", productId: P, field: "tags" }, tagsToValue(["oak", "sale"])),
      change(doc, { kind: "product", productId: P, field: "handle" }, "new-handle"),
    ];
    const split = splitChanges(c);
    expect(productInput(P, split.product)).toEqual({ id: P, title: "New table", seo: { title: "New SEO" }, tags: ["oak", "sale"] });
    expect(split.handle).toHaveLength(1);
  });

  it("builds variant inputs with the inventory item fields together", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, []);
    const c = [
      change(doc, { kind: "variant", productId: P, variantId: V, field: "price" }, "120.00"),
      change(doc, { kind: "variant", productId: P, variantId: V, field: "compareAtPrice" }, ""),
      change(doc, { kind: "variant", productId: P, variantId: V, field: "sku" }, "T-2"),
      change(doc, { kind: "variant", productId: P, variantId: V, field: "tracked" }, "false"),
    ];
    expect(variantInputs(splitChanges(c).variant)).toEqual([{ id: V, price: "120.00", compareAtPrice: null, inventoryItem: { sku: "T-2", tracked: false } }]);
  });
});

describe("applyBundle", () => {
  it("writes product, variant, metafield and stock changes, in order", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, ["fr"]);
    const out = await applyBundle(
      shop.gql,
      bundle([
        change(doc, { kind: "product", productId: P, field: "title" }, "Oak table"),
        change(doc, { kind: "variant", productId: P, variantId: V, field: "price" }, "125.50"),
        change(doc, { kind: "metafield", productId: P, ownerId: P, ownerKind: "PRODUCT", namespace: "custom", key: "material", type: "single_line_text_field" }, "Walnut"),
        change(doc, { kind: "stock", productId: P, variantId: V, itemId: `item-${V}`, locationId: LOC_A }, "9"),
      ]),
    );
    expect([...out.values()].every((o) => o.status === "done")).toBe(true);
    const p = shop.products.get(P)!;
    expect(p.title).toBe("Oak table");
    expect(p.variants[0]!.price).toBe("125.50");
    expect(p.metafields["custom.material"]!.value).toBe("Walnut");
    expect(p.variants[0]!.levels[LOC_A]).toBe(9);
    const order = shop.calls.map((c) => c.op).filter((o) => o.startsWith("Editor") && !o.includes("Product") || o === "EditorProductUpdate");
    expect(order.indexOf("EditorProductUpdate")).toBeLessThan(order.indexOf("EditorVariantsUpdate"));
    expect(order.indexOf("EditorVariantsUpdate")).toBeLessThan(order.indexOf("EditorMetafieldsSet"));
    expect(order.indexOf("EditorMetafieldsSet")).toBeLessThan(order.indexOf("EditorStockSet"));
  });

  it("changes the handle in its own call and asks for a redirect", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, []);
    await applyBundle(shop.gql, bundle([change(doc, { kind: "product", productId: P, field: "handle" }, "oak-table")]));
    const call = shop.calls.find((c) => c.op === "EditorProductUpdate")!;
    expect(call.variables.product).toEqual({ id: P, handle: "oak-table", redirectNewHandle: true });
    expect(shop.products.get(P)!.handle).toBe("oak-table");
  });

  it("deletes a metafield when the value is cleared", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, []);
    await applyBundle(shop.gql, bundle([change(doc, { kind: "metafield", productId: P, ownerId: P, ownerKind: "PRODUCT", namespace: "custom", key: "material", type: "single_line_text_field" }, null)]));
    expect(shop.products.get(P)!.metafields["custom.material"]).toBeUndefined();
  });

  it("isolates one bad metafield: the others are still saved", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, []);
    const mf = (key: string, after: string) => change(doc, { kind: "metafield", productId: P, ownerId: P, ownerKind: "PRODUCT", namespace: "custom", key, type: "single_line_text_field" }, after);
    const good = mf("a", "ok");
    const bad = mf("b", "BAD");
    const out = await applyBundle(shop.gql, bundle([good, bad]));
    expect(out.get(good.id)!.status).toBe("done");
    expect(out.get(bad.id)!.status).toBe("failed");
    expect(out.get(bad.id)!.message).toContain("invalid");
    expect(shop.products.get(P)!.metafields["custom.a"]!.value).toBe("ok");
  });

  it("stops after a failed step and leaves the later steps alone", async () => {
    const { shop } = setup();
    shop.failOn.set("EditorProductUpdate", "Title is too long");
    const doc = await loadProductDoc(shop.gql, P, []);
    const t = change(doc, { kind: "product", productId: P, field: "title" }, "X");
    const v = change(doc, { kind: "variant", productId: P, variantId: V, field: "price" }, "1.00");
    const out = await applyBundle(shop.gql, bundle([t, v]));
    expect(out.get(t.id)).toEqual({ status: "failed", message: "Title is too long (title)".replace(" (title)", "") + " (x)" });
    expect(out.get(v.id)!.status).toBe("not applied");
    expect(shop.count("EditorVariantsUpdate")).toBe(0);
    expect(shop.products.get(P)!.variants[0]!.price).toBe("100.00");
  });

  it("turns a thrown error into a failed change, never into a crash", async () => {
    const { shop } = setup();
    shop.failOn.set("EditorVariantsUpdate", "throw:Shopify did not answer");
    const doc = await loadProductDoc(shop.gql, P, []);
    const v = change(doc, { kind: "variant", productId: P, variantId: V, field: "price" }, "1.00");
    const out = await applyBundle(shop.gql, bundle([v]));
    expect(out.get(v.id)).toEqual({ status: "failed", message: "Shopify did not answer" });
  });

  it("refuses a stock change at a location the variant is not stocked at", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, []);
    const s = change(doc, { kind: "stock", productId: P, variantId: V, itemId: `item-${V}`, locationId: "gid://shopify/Location/9" }, "3");
    const out = await applyBundle(shop.gql, bundle([s]));
    expect(out.get(s.id)!.status).toBe("failed");
    expect(shop.count("EditorStockSet")).toBe(0);
  });

  it("uses the quantity read before as the compare value, so a changed stock is not overwritten", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, []);
    shop.products.get(P)!.variants[0]!.levels[LOC_A] = 7; // someone else changed it
    const s = change(doc, { kind: "stock", productId: P, variantId: V, itemId: `item-${V}`, locationId: LOC_A }, "9");
    const out = await applyBundle(shop.gql, bundle([s]));
    expect(out.get(s.id)!.status).toBe("failed");
    expect(shop.products.get(P)!.variants[0]!.levels[LOC_A]).toBe(7);
  });
});

describe("translations", () => {
  const titleT = (slot: string): Target => ({ kind: "translation", productId: P, resourceId: P, resource: "product", field: "title", slot });

  it("registers a translation with the digest of the source", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, ["fr", "de"]);
    const out = await applyBundle(shop.gql, bundle([change(doc, titleT("fr"), "Table en chêne"), change(doc, titleT("de"), "Eichentisch")]));
    expect([...out.values()].map((o) => o.status)).toEqual(["done", "done"]);
    expect(shop.translation(P, "title", "fr")).toBe("Table en chêne");
    expect(shop.translation(P, "title", "de")).toBe("Eichentisch");
  });

  it("reads the digest AFTER the source is saved, so a title change and its translation go together", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, ["fr"]);
    const out = await applyBundle(
      shop.gql,
      bundle([change(doc, { kind: "product", productId: P, field: "title" }, "Oak table"), change(doc, titleT("fr"), "Table en chêne")]),
    );
    expect([...out.values()].map((o) => o.status)).toEqual(["done", "done"]);
    expect(shop.translation(P, "title", "fr")).toBe("Table en chêne");
  });

  it("removes a translation only in the language that was cleared", async () => {
    const { shop } = setup();
    shop.setTranslation(P, "title", "fr", "Table");
    shop.setTranslation(P, "title", "de", "Tisch");
    shop.setTranslation(P, "body_html", "fr", "<p>Texte</p>");
    const doc = await loadProductDoc(shop.gql, P, ["fr", "de"]);
    const out = await applyBundle(shop.gql, bundle([change(doc, titleT("fr"), null)]));
    expect(out.get(targetKey(titleT("fr")))!.status).toBe("done");
    expect(shop.translation(P, "title", "fr")).toBeUndefined();
    expect(shop.translation(P, "title", "de")).toBe("Tisch");
    expect(shop.translation(P, "body_html", "fr")).toBe("<p>Texte</p>");
  });

  it("explains a field that has no source text yet", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, ["fr"]);
    const t: Target = { kind: "translation", productId: P, resourceId: P, resource: "product", field: "meta_description", slot: "fr" };
    const out = await applyBundle(shop.gql, bundle([change(doc, t, "Texte")]));
    expect(out.get(targetKey(t))!.status).toBe("failed");
    expect(out.get(targetKey(t))!.message).toContain("no source text");
  });

  it("translates a metafield through its own id", async () => {
    const { shop } = setup();
    const doc = await loadProductDoc(shop.gql, P, ["fr"]);
    const mfId = doc.metafields["custom.material"]!.id;
    const t: Target = { kind: "translation", productId: P, resourceId: mfId, resource: "metafield", field: "value", slot: "fr", mfType: "single_line_text_field" };
    const out = await applyBundle(shop.gql, bundle([change(doc, t, "Chêne")]));
    expect(out.get(targetKey(t))!.status).toBe("done");
    expect(shop.translation(mfId, "value", "fr")).toBe("Chêne");
  });
});
