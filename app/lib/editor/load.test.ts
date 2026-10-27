import { describe, expect, it } from "vitest";
import { buildTranslationsQuery, buildVariantMetafieldsQuery, loadDefinitions, loadProduct, loadProductDoc, loadShopInfo, loadTranslations, loadVariantMetafields, parseTranslationNodes, searchCategories, searchProducts, searchQueryFor } from "./load";
import { fakeProduct, fakeVariant, FakeShopify } from "./fake";
import { variantTitle } from "./doc";
import { readValues } from "./read";
import { targetKey, type Target } from "./model";

const P = "gid://shopify/Product/1";

describe("loadProductDoc", () => {
  it("reads the product, its variants with stock, metafields and translations", async () => {
    const shop = new FakeShopify([
      fakeProduct(P, {
        title: "Table",
        metafields: { "custom.material": { id: "gid://shopify/Metafield/1", type: "single_line_text_field", value: "Oak" } },
        variants: [fakeVariant("v1", { selectedOptions: [{ name: "Size", value: "180 cm" }], levels: { L1: 3, L2: 0 } }), fakeVariant("v2", { position: 2, selectedOptions: [{ name: "Size", value: "220 cm" }] })],
      }),
    ]);
    shop.setTranslation(P, "title", "fr", "Table FR");
    const doc = await loadProductDoc(shop.gql, P, ["fr", "de"]);
    expect(doc.title).toBe("Table");
    expect(doc.variants).toHaveLength(2);
    expect(doc.variants[0]!.levels).toEqual([{ locationId: "L1", quantity: 3 }, { locationId: "L2", quantity: 0 }]);
    expect(variantTitle(doc.variants[0]!)).toBe("180 cm");
    expect(doc.metafields["custom.material"]!.value).toBe("Oak");
    expect(doc.translations[P]!.values.title!.fr!.value).toBe("Table FR");
    expect(doc.translations[P]!.content.title!.digest).toBeTruthy();
    expect(doc.translations["gid://shopify/Metafield/1"]!.content.value!.value).toBe("Oak");
  });

  it("says plainly when the product no longer exists", async () => {
    await expect(loadProduct(new FakeShopify().gql, P)).rejects.toThrow("no longer exists");
  });

  it("names a product with no options 'Default variant'", async () => {
    const doc = await loadProduct(new FakeShopify([fakeProduct(P)]).gql, P);
    expect(variantTitle(doc.variants[0]!)).toBe("Default variant");
  });
});

describe("variant metafields", () => {
  it("reads only the chosen keys, and says 'none' for a variant without a value", async () => {
    const shop = new FakeShopify([
      fakeProduct(P, {
        variants: [
          fakeVariant("v1", { metafields: { "custom.length": { id: "m1", type: "number_integer", value: "180" } } }),
          fakeVariant("v2", { position: 2 }),
        ],
      }),
    ]);
    const out = await loadVariantMetafields(shop.gql, ["v1", "v2"], [{ namespace: "custom", key: "length" }]);
    expect(out.v1!["custom.length"]).toMatchObject({ value: "180", type: "number_integer" });
    expect(out.v2!["custom.length"]).toBeNull();
  });
  it("builds safe aliases for odd keys", () => {
    const q = buildVariantMetafieldsQuery([{ namespace: 'a"b', key: "k" }]);
    expect(q).toContain('namespace: "a\\"b"');
  });
});

describe("translations", () => {
  it("builds one alias per slot and a market variable only for market slots", () => {
    const q = buildTranslationsQuery(["fr", "en@gid://shopify/Market/1"]);
    expect(q).toContain("t0: translations(locale: $l0)");
    expect(q).toContain("t1: translations(locale: $l1, marketId: $m1)");
    expect(q).toContain("market { id }");
    expect(buildTranslationsQuery(["fr"])).not.toContain("market");
  });
  it("a language slot ignores market-specific text and the reverse", () => {
    const res = parseTranslationNodes(
      [
        {
          resourceId: "r",
          translatableContent: [{ key: "title", value: "T", digest: "d" }],
          t0: [{ key: "title", value: "General", outdated: false, market: null }, { key: "title", value: "Market only", outdated: false, market: { id: "m" } }],
          t1: [{ key: "title", value: "Market only", outdated: true, market: { id: "m" } }],
        },
      ],
      ["fr", "fr@m"],
    );
    expect(res.r!.values.title).toEqual({ fr: { value: "General", outdated: false }, "fr@m": { value: "Market only", outdated: true } });
  });
  it("empty translations are not translations", async () => {
    const shop = new FakeShopify([fakeProduct(P)]);
    shop.setTranslation(P, "title", "fr", "");
    const res = await loadTranslations(shop.gql, [P], ["fr"]);
    expect(res[P]!.values.title).toBeUndefined();
  });
  it("reads nothing when there are no languages", async () => {
    expect(await loadTranslations(new FakeShopify().gql, [P], [])).toEqual({});
  });
});

describe("readValues", () => {
  it("reads every kind of target in the same text form as the doc", async () => {
    const shop = new FakeShopify([
      fakeProduct(P, {
        tags: ["a"],
        metafields: { "custom.m": { id: "m1", type: "single_line_text_field", value: "X" } },
        variants: [fakeVariant("v1", { price: "5.00", levels: { L1: 4 } })],
      }),
    ]);
    shop.setTranslation(P, "title", "fr", "FR");
    const targets: Target[] = [
      { kind: "product", productId: P, field: "tags" },
      { kind: "variant", productId: P, variantId: "v1", field: "price" },
      { kind: "variant", productId: P, variantId: "v1", field: "tracked" },
      { kind: "stock", productId: P, variantId: "v1", itemId: "item-v1", locationId: "L1" },
      { kind: "stock", productId: P, variantId: "v1", itemId: "item-v1", locationId: "L9" },
      { kind: "metafield", productId: P, ownerId: P, ownerKind: "PRODUCT", namespace: "custom", key: "m", type: "single_line_text_field" },
      { kind: "metafield", productId: P, ownerId: P, ownerKind: "PRODUCT", namespace: "custom", key: "none", type: "single_line_text_field" },
      { kind: "translation", productId: P, resourceId: P, resource: "product", field: "title", slot: "fr" },
      { kind: "product", productId: "gone", field: "title" },
    ];
    const got = await readValues(shop.gql, targets);
    expect(got.get(targetKey(targets[0]!))).toBe(JSON.stringify(["a"]));
    expect(got.get(targetKey(targets[1]!))).toBe("5.00");
    expect(got.get(targetKey(targets[2]!))).toBe("true");
    expect(got.get(targetKey(targets[3]!))).toBe("4");
    expect(got.get(targetKey(targets[4]!))).toBeNull();
    expect(got.get(targetKey(targets[5]!))).toBe("X");
    expect(got.get(targetKey(targets[6]!))).toBeNull();
    expect(got.get(targetKey(targets[7]!))).toBe("FR");
    expect(got.has(targetKey(targets[8]!))).toBe(false);
  });
});

describe("searchQueryFor", () => {
  it("searches title, handle and SKU by prefix, and strips quotes", () => {
    expect(searchQueryFor("oak table")).toBe("(title:oak* table*) OR (handle:oak-table*) OR (sku:oaktable*)");
    expect(searchQueryFor('a"b')).not.toContain('"');
    expect(searchQueryFor("   ")).toBe("");
  });
});

describe("shop info, definitions and search", () => {
  it("reads languages, locations and currency", async () => {
    const info = await loadShopInfo(new FakeShopify().gql);
    expect(info).toMatchObject({ currency: "GBP", domain: "hardman.myshopify.com" });
    expect(info.locales.map((l) => l.locale)).toEqual(["en", "fr", "de"]);
    expect(info.locations).toHaveLength(1);
  });
  it("reads definitions for one owner kind, sorted", async () => {
    const shop = new FakeShopify();
    shop.definitions.push(
      { id: "d1", ownerType: "PRODUCT", namespace: "custom", key: "b", name: "Beta", type: { name: "boolean" } },
      { id: "d2", ownerType: "PRODUCT", namespace: "custom", key: "a", name: "Alpha", type: { name: "single_line_text_field" }, validations: [{ name: "max", value: "5" }] },
      { id: "d3", ownerType: "PRODUCTVARIANT", namespace: "custom", key: "len", name: "Length", type: { name: "number_integer" } },
    );
    const defs = await loadDefinitions(shop.gql, "PRODUCT");
    expect(defs.map((d) => d.name)).toEqual(["Alpha", "Beta"]);
    expect(defs[0]!.validations).toEqual([{ name: "max", value: "5" }]);
  });
  it("finds products by title and by SKU, and categories by name", async () => {
    const shop = new FakeShopify([fakeProduct(P, { title: "Oak table", variants: [fakeVariant("v1", { sku: "OT-180" })] })]);
    expect((await searchProducts(shop.gql, "oak")).map((p) => p.id)).toEqual([P]);
    expect((await searchProducts(shop.gql, "ot-180")).map((p) => p.id)).toEqual([P]);
    expect(await searchProducts(shop.gql, " ")).toEqual([]);
    expect((await searchCategories(shop.gql, "dining"))[0]!.name).toBe("Dining Tables");
  });
});
