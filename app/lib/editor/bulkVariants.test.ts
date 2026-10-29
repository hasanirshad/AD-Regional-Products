import { describe, expect, it } from "vitest";
import {
  MAX_VARIANTS,
  columnsFor,
  cellBlocker,
  loadVariantCells,
  loadVariantRows,
  newVariantCache,
  translatableVariantMetafield,
  variantCellText,
  variantFieldColumn,
  variantMetaColumn,
  variantRowsOf,
  variantTargetOf,
  variantTranslationColumn,
} from "./bulkVariants";
import { buildChanges, toBundles, type ChangeContext } from "./changes";
import { fakeProduct, fakeVariant, FakeShopify } from "./fake";
import { putEdit, type EditMap } from "./edits";
import { runBundles } from "./run";
import { targetKey, type Target, type Value } from "./model";

const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const DEF = { namespace: "custom", key: "length", name: "Length", type: "single_line_text_field", validations: [] };
const hooks = { onProgress: () => {}, shouldStop: () => false, onStage: () => {}, retryWaitMs: 0 } as never;

function shop() {
  const s = new FakeShopify([
    fakeProduct(P1, {
      title: "Table",
      variants: [
        fakeVariant(V(11), { title: "Oak / 180", position: 1, price: "100.00", metafields: { "custom.length": { id: "gid://shopify/Metafield/11", type: "single_line_text_field", value: "180 cm" } } }),
        fakeVariant(V(12), { title: "Oak / 220", position: 2, price: "120.00" }),
      ],
    }),
    fakeProduct(P2, { title: "Bench", variants: [fakeVariant(V(21), { title: "Default Title", price: "50.00" })] }),
  ]);
  return s;
}

const ctxFor = (cache: ReturnType<typeof newVariantCache>): ChangeContext => {
  const rows = [...cache.rows.values()].flat();
  const row = (id: string) => rows.find((r) => r.id === id);
  const baseOf = (t: Target): Value => cache.values.get(targetKey(t)) ?? null;
  return {
    baseOf,
    effectiveOf: baseOf,
    productTitle: (id) => rows.find((r) => r.productId === id)?.productTitle ?? id,
    productHandle: (id) => rows.find((r) => r.productId === id)?.productHandle ?? id,
    variantTitle: (id) => row(id)?.title ?? id,
    slotLabel: (s) => s,
    locationName: (id) => id,
    metafieldName: (t) => t.key,
    resourceName: (t) => `Length · ${[...cache.metafieldIds].find(([, v]) => v === t.resourceId)?.[0] ?? ""}`,
  };
};

describe("reading the variants of chosen products", () => {
  it("reads every variant with its plain fields, in position order", async () => {
    const s = shop();
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1, P2], cache);
    const rows = variantRowsOf([P1, P2], cache);
    expect(rows.map((r) => r.title)).toEqual(["Oak / 180", "Oak / 220", "Default Title"]);
    expect(rows[0]).toMatchObject({ productId: P1, productTitle: "Table", id: V(11) });
    const price = variantFieldColumn("price");
    expect(variantCellText(price, rows[1]!, cache, {})).toBe("120.00");
    expect(cache.truncated.size).toBe(0);
  });

  it("does not read a product twice and gives a deleted product no rows", async () => {
    const s = shop();
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1, "gid://shopify/Product/404"], cache);
    await loadVariantRows(s.gql, [P1], cache);
    expect(s.count("BulkVariantRows")).toBe(1);
    expect(cache.rows.get("gid://shopify/Product/404")).toEqual([]);
  });

  it("reads three products per call and stops when told to", async () => {
    const s = new FakeShopify([1, 2, 3, 4, 5].map((n) => fakeProduct(`gid://shopify/Product/${n}`, { variants: [fakeVariant(V(n * 10))] })));
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [1, 2, 3, 4, 5].map((n) => `gid://shopify/Product/${n}`), cache);
    expect(s.count("BulkVariantRows")).toBe(2);
    const again = newVariantCache();
    await loadVariantRows(s.gql, [`gid://shopify/Product/1`], again, { shouldStop: () => true });
    expect(again.rows.size).toBe(0);
  });

  it("pages a product with more than 100 variants and flags one over the limit", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => fakeVariant(V(1000 + i), { title: `v${i}`, position: i + 1 }));
    const s = new FakeShopify([fakeProduct(P1, { variants: many(130) }), fakeProduct(P2, { variants: many(MAX_VARIANTS + 40).map((v, i) => ({ ...v, id: V(5000 + i) })) })]);
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1, P2], cache);
    expect(cache.rows.get(P1)).toHaveLength(130);
    expect(cache.truncated.has(P1)).toBe(false);
    expect(cache.rows.get(P2)).toHaveLength(MAX_VARIANTS);
    expect(cache.truncated.has(P2)).toBe(true);
  });
});

describe("variant metafields and their translations", () => {
  it("reads the metafield value and id, and the saved translation", async () => {
    const s = shop();
    s.setTranslation("gid://shopify/Metafield/11", "value", "fr", "180 cm (FR)");
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1], cache);
    const rows = variantRowsOf([P1], cache);
    const meta = variantMetaColumn(DEF);
    const tr = variantTranslationColumn(DEF, "fr", "French");
    await loadVariantCells(s.gql, rows, [meta, tr], cache);
    expect(variantCellText(meta, rows[0]!, cache, {})).toBe("180 cm");
    expect(variantCellText(meta, rows[1]!, cache, {})).toBe("");
    expect(variantCellText(tr, rows[0]!, cache, {})).toBe("180 cm (FR)");
    expect(cache.metafieldIds.get(`${V(11)}|custom.length`)).toBe("gid://shopify/Metafield/11");
  });

  it("cannot translate a metafield that has no value yet", async () => {
    const s = shop();
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1], cache);
    const rows = variantRowsOf([P1], cache);
    const tr = variantTranslationColumn(DEF, "fr", "French");
    await loadVariantCells(s.gql, rows, [variantMetaColumn(DEF), tr], cache);
    expect(variantTargetOf(tr, rows[1]!, cache)).toBeNull();
    expect(cellBlocker(tr, rows[1]!, cache)).toBe("Save the value first");
    expect(cellBlocker(tr, rows[0]!, cache)).toBeNull();
    expect(variantTargetOf(tr, rows[0]!, cache)).toMatchObject({ kind: "translation", resource: "metafield", resourceId: "gid://shopify/Metafield/11", field: "value", slot: "fr" });
  });

  it("does not read a cell twice", async () => {
    const s = shop();
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1], cache);
    const rows = variantRowsOf([P1], cache);
    await loadVariantCells(s.gql, rows, [variantMetaColumn(DEF)], cache);
    const n = s.count("EditorVariantMetafields");
    await loadVariantCells(s.gql, rows, [variantMetaColumn(DEF)], cache);
    expect(s.count("EditorVariantMetafields")).toBe(n);
  });

  it("offers translation only for single text, multi-line text and links", () => {
    expect(translatableVariantMetafield("single_line_text_field")).toBe(true);
    expect(translatableVariantMetafield("multi_line_text_field")).toBe(true);
    expect(translatableVariantMetafield("url")).toBe(true);
    expect(translatableVariantMetafield("list.single_line_text_field")).toBe(false);
    expect(translatableVariantMetafield("number_integer")).toBe(false);
    expect(translatableVariantMetafield("boolean")).toBe(false);
  });
});

describe("saving variant edits", () => {
  it("applies a price, a metafield and a translation, and reads them back", async () => {
    const s = shop();
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1, P2], cache);
    const rows = variantRowsOf([P1, P2], cache);
    const price = variantFieldColumn("price");
    const meta = variantMetaColumn(DEF);
    const tr = variantTranslationColumn(DEF, "fr", "French");
    await loadVariantCells(s.gql, rows, [price, meta, tr], cache);

    let edits: EditMap = {};
    const put = (col: typeof price, row: (typeof rows)[number], value: Value) => {
      const t = variantTargetOf(col, row, cache)!;
      edits = putEdit(edits, t, value, cache.values.get(targetKey(t)) ?? null);
    };
    put(price, rows[1]!, "130.00"); // Table, Oak / 220
    put(price, rows[2]!, "55.00"); // Bench
    put(meta, rows[1]!, "220 cm"); // a metafield that had no value
    put(tr, rows[0]!, "180 cm (fr)"); // translate the saved metafield

    const built = buildChanges(edits, ctxFor(cache));
    expect(built.errors).toEqual([]);
    expect(built.changes).toHaveLength(4);
    const bundles = toBundles(built.changes, ctxFor(cache));
    expect(bundles.map((b) => b.productId).sort()).toEqual([P1, P2]);

    const summary = await runBundles(s.gql, bundles, hooks);
    expect(JSON.stringify(summary)).not.toMatch(/"failed"|"notVerified"/);
    const t = s.products.get(P1)!;
    expect(t.variants[1]!.price).toBe("130.00");
    expect(t.variants[0]!.price).toBe("100.00");
    expect(s.products.get(P2)!.variants[0]!.price).toBe("55.00");
    expect(t.variants[1]!.metafields["custom.length"]?.value).toBe("220 cm");
    expect(s.translation("gid://shopify/Metafield/11", "value", "fr")).toBe("180 cm (fr)");
  });

  it("labels a metafield translation with the thing it belongs to", () => {
    const cache = newVariantCache();
    cache.metafieldIds.set(`${V(11)}|custom.length`, "gid://shopify/Metafield/11");
    const t: Target = { kind: "translation", productId: P1, resourceId: "gid://shopify/Metafield/11", resource: "metafield", field: "value", slot: "fr" };
    const built = buildChanges({ [targetKey(t)]: { target: t, value: "x" } }, ctxFor(cache));
    expect(built.changes[0]!.label).toContain("Length");
    expect(built.changes[0]!.label).not.toContain("Metafield value");
  });
});

describe("columns for the choices", () => {
  const defs = [
    { id: "d1", ownerType: "PRODUCTVARIANT", namespace: "custom", key: "length", name: "Length", type: "single_line_text_field", validations: [] },
    { id: "d2", ownerType: "PRODUCTVARIANT", namespace: "custom", key: "seats", name: "Seats", type: "number_integer", validations: [] },
  ] as never[];
  const slots = [
    { key: "fr", label: "French", locale: "fr", marketId: null },
    { key: "fr@gid://shopify/Market/5", label: "French · Switzerland", locale: "fr", marketId: "gid://shopify/Market/5" },
  ] as never[];

  it("puts fields first, then metafields, then each translatable metafield in every chosen language and adaptation", () => {
    const cols = columnsFor(["sku", "price"], ["custom.length", "custom.seats"], ["fr", "fr@gid://shopify/Market/5"], defs, slots);
    expect(cols.map((c) => c.id)).toEqual(["v:price", "v:sku", "vm:custom.length", "vm:custom.seats", "vt:fr:custom.length", "vt:fr@gid://shopify/Market/5:custom.length"]);
  });

  it("gives no translation column to a number, and none without a chosen language", () => {
    expect(columnsFor([], ["custom.seats"], ["fr"], defs, slots).map((c) => c.id)).toEqual(["vm:custom.seats"]);
    expect(columnsFor([], ["custom.length"], [], defs, slots).map((c) => c.id)).toEqual(["vm:custom.length"]);
  });

  it("translates a market adaptation: it reads and writes the adaptation slot, not the plain language", async () => {
    const s = shop();
    const slot = "fr@gid://shopify/Market/5";
    s.setTranslation("gid://shopify/Metafield/11", "value", slot, "180 cm CH");
    s.setTranslation("gid://shopify/Metafield/11", "value", "fr", "180 cm FR");
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1], cache);
    const rows = variantRowsOf([P1], cache);
    const cols = columnsFor([], ["custom.length"], [slot], defs, slots);
    await loadVariantCells(s.gql, rows, cols, cache);
    const tr = cols.find((c) => c.group === "Translations")!;
    expect(variantCellText(tr, rows[0]!, cache, {})).toBe("180 cm CH");
  });
});

describe("saving a market adaptation", () => {
  it("writes the translation for the market only", async () => {
    const s = shop();
    const slot = "fr@gid://shopify/Market/5";
    const cache = newVariantCache();
    await loadVariantRows(s.gql, [P1], cache);
    const rows = variantRowsOf([P1], cache);
    const col = variantTranslationColumn(DEF, slot, "French · Switzerland");
    await loadVariantCells(s.gql, rows, [variantMetaColumn(DEF), col], cache);
    const t = variantTargetOf(col, rows[0]!, cache)!;
    const edits = putEdit({}, t, "180 cm CH", null);
    const built = buildChanges(edits, ctxFor(cache));
    await runBundles(s.gql, toBundles(built.changes, ctxFor(cache)), hooks);
    expect(s.translation("gid://shopify/Metafield/11", "value", slot)).toBe("180 cm CH");
    expect(s.translation("gid://shopify/Metafield/11", "value", "fr")).toBeUndefined();
  });
});
