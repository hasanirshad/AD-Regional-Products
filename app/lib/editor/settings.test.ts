import { describe, expect, it } from "vitest";
import { FakeShopify } from "./fake";
import { baseOf } from "./doc";
import { loadProductDoc } from "./load";
import { fakeProduct } from "./fake";
import {
  MAX_UNDO_CHARS,
  clearUndo,
  loadSettings,
  parseBookmarks,
  parseDraftState,
  parseSets,
  parseUndo,
  saveBookmarks,
  saveSets,
  saveUndo,
  serializeDraftState,
  serializeSets,
  serializeUndo,
  undoRecordFrom,
} from "./settings";
import { targetKey, type Change } from "./model";

describe("saved sets", () => {
  it("round-trips, trims names and drops broken entries and repeats", () => {
    const raw = serializeSets([{ id: "a", name: " Dining table content ", product: ["custom.a"], variant: ["custom.length"] }]);
    expect(parseSets(raw)).toEqual([{ id: "a", name: "Dining table content", product: ["custom.a"], variant: ["custom.length"] }]);
    expect(parseSets(JSON.stringify({ sets: [{ id: "a", name: "x" }, { id: "a", name: "dup" }, { name: "no id" }, { id: "b", name: " " }] }))).toHaveLength(1);
    expect(parseSets("not json")).toEqual([]);
    expect(parseSets(null)).toEqual([]);
  });
});

describe("bookmarks", () => {
  it("reads good entries and ignores the rest", () => {
    expect(parseBookmarks(JSON.stringify({ items: [{ id: "1", title: "T", handle: "t" }, { id: 2 }] }))).toEqual([{ id: "1", title: "T", handle: "t" }]);
    expect(parseBookmarks(undefined)).toEqual([]);
  });
});

describe("draft state", () => {
  it("accepts a known step and rejects an unknown one", () => {
    const raw = serializeDraftState({ step: "tags", product: ["custom.a"], variant: [], savedAt: "t" });
    expect(parseDraftState(raw)).toEqual({ step: "tags", product: ["custom.a"], variant: [], savedAt: "t" });
    expect(parseDraftState(JSON.stringify({ step: "nope" }))).toBeNull();
    expect(parseDraftState("{")).toBeNull();
  });
});

describe("undo record", () => {
  const change = (n: number, bytes = 10): Change => ({
    id: `c${n}`,
    target: { kind: "product", productId: "p1", field: "title" },
    productId: "p1",
    productTitle: "P",
    label: "Title",
    tab: "basic",
    before: "a".repeat(bytes),
    after: "b",
  });

  it("round-trips", () => {
    const rec = undoRecordFrom("Edit product", [change(1)], new Date("2026-10-27T10:00:00Z"));
    const parsed = parseUndo(serializeUndo(rec));
    expect(parsed?.action).toBe("Edit product");
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.at).toBe("2026-10-27T10:00:00.000Z");
  });

  it("is not saved when it would not fit in a metafield", () => {
    const rec = undoRecordFrom("Bulk edit", [change(1, MAX_UNDO_CHARS)]);
    expect(serializeUndo(rec)).toBeNull();
  });

  it("an empty or damaged record is no record", () => {
    expect(parseUndo(JSON.stringify({ at: "t", items: [] }))).toBeNull();
    expect(parseUndo("nope")).toBeNull();
  });
});

describe("saving in Shopify", () => {
  it("saves into the app-owned namespace on the installation and reads it back", async () => {
    const shop = new FakeShopify();
    const s0 = await loadSettings(shop.gql);
    expect(s0).toMatchObject({ sets: [], bookmarks: [], undo: null });
    await saveSets(shop.gql, s0.installationId, [{ id: "a", name: "Set", product: ["custom.a"], variant: [] }]);
    await saveBookmarks(shop.gql, s0.installationId, [{ id: "p", title: "Table", handle: "table" }]);
    const ok = await saveUndo(shop.gql, s0.installationId, undoRecordFrom("Edit", []));
    expect(ok).toBe(true);
    const sent = shop.calls.filter((c) => c.op === "EditorSaveSetting").map((c) => (c.variables.metafields as { namespace: string }[])[0]!.namespace);
    expect(sent).toEqual(["$app", "$app", "$app"]);
    const s1 = await loadSettings(shop.gql);
    expect(s1.sets[0]!.name).toBe("Set");
    expect(s1.bookmarks[0]!.title).toBe("Table");
    await clearUndo(shop.gql, s1.installationId);
    expect((await loadSettings(shop.gql)).undo).toBeNull();
  });

  it("throws Shopify's message when saving is refused", async () => {
    const shop = new FakeShopify();
    shop.failOn.set("EditorSaveSetting", "Not allowed");
    await expect(saveSets(shop.gql, "i", [])).rejects.toThrow("Not allowed");
  });
});

describe("a product doc", () => {
  it("is read in full and answers baseOf for every kind of target", async () => {
    const shop = new FakeShopify([fakeProduct("gid://shopify/Product/1", { tags: ["a", "b"], category: { id: "gid://shopify/TaxonomyCategory/aa-1", name: "Tables" } })]);
    const doc = await loadProductDoc(shop.gql, "gid://shopify/Product/1", ["fr"]);
    expect(baseOf(doc, { kind: "product", productId: doc.id, field: "tags" })).toBe(JSON.stringify(["a", "b"]));
    expect(baseOf(doc, { kind: "product", productId: doc.id, field: "category" })).toBe("gid://shopify/TaxonomyCategory/aa-1");
    expect(baseOf(doc, { kind: "product", productId: doc.id, field: "seoTitle" })).toBeNull();
    expect(targetKey({ kind: "product", productId: doc.id, field: "title" })).toBe(`p|${doc.id}|title`);
  });
});
