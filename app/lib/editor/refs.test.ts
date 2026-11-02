import { describe, expect, it } from "vitest";
import { FakeShopify } from "./fake";
import { acceptedFileKinds, fileItem, fileNameOf, filterItems, loadFilePage, loadMetaobjectPage, loadMetaobjectType, loadPickLabels, metaobjectDefinitionId } from "./refs";
import { loadAllRefLabels } from "./load";
import { buildElements, draftFromValue, emptyDraft, formatValue, referenceIds } from "./mfTypes";

const DEF = "gid://shopify/MetaobjectDefinition/1";
const img = (n: number) => ({ __typename: "MediaImage", id: `gid://shopify/MediaImage/${n}`, alt: n === 1 ? "Oak top" : null, image: { url: `https://cdn.shopify.com/s/files/oak-${n}.jpg?v=1` } });

function shop() {
  const s = new FakeShopify();
  s.metaobjectDefinitions = [{ id: DEF, type: "swatch", name: "Swatch" }];
  s.metaobjects = Array.from({ length: 5 }, (_, i) => ({ id: `gid://shopify/Metaobject/${i + 1}`, type: "swatch", displayName: i === 2 ? null : `Oak ${i + 1}`, handle: `oak-${i + 1}` }));
  s.metaobjects.push({ id: "gid://shopify/Metaobject/99", type: "other", displayName: "Not a swatch", handle: "x" });
  s.files = [img(1), img(2), { __typename: "GenericFile", id: "gid://shopify/GenericFile/3", alt: null, url: "https://cdn.shopify.com/s/files/spec%20sheet.pdf?v=2", mimeType: "application/pdf" }, { __typename: "Video", id: "gid://shopify/Video/4", alt: null, filename: "hero.mp4" }];
  return s;
}

describe("definitions and rules", () => {
  it("reads the metaobject definition id and accepted file kinds from the validations", () => {
    expect(metaobjectDefinitionId([{ name: "metaobject_definition_id", value: DEF }])).toBe(DEF);
    expect(metaobjectDefinitionId([])).toBeNull();
    expect(acceptedFileKinds([])).toEqual(["image", "video", "file"]);
    expect(acceptedFileKinds([{ name: "file_type_options", value: '["Image"]' }])).toEqual(["image"]);
    expect(acceptedFileKinds([{ name: "file_type_options", value: '["Image","GenericFile"]' }])).toEqual(["image", "file"]);
    expect(acceptedFileKinds([{ name: "file_type_options", value: "not json" }])).toEqual(["image", "video", "file"]);
  });
  it("names files from their url", () => {
    expect(fileNameOf("https://cdn.shopify.com/s/files/spec%20sheet.pdf?v=2")).toBe("spec sheet.pdf");
    expect(fileNameOf(null)).toBe("");
  });
});

describe("loading", () => {
  it("finds the metaobject type, then its entries by page, using the handle when there is no display name", async () => {
    const s = shop();
    s.pageSize = 2;
    expect(await loadMetaobjectType(s.gql, DEF)).toEqual({ type: "swatch", name: "Swatch" });
    expect(await loadMetaobjectType(s.gql, "gid://missing")).toBeNull();
    const first = await loadMetaobjectPage(s.gql, "swatch");
    expect(first.items.map((i) => i.label)).toEqual(["Oak 1", "Oak 2"]);
    expect(first.next).toBe("2");
    const second = await loadMetaobjectPage(s.gql, "swatch", first.next);
    expect(second.items.map((i) => i.label)).toEqual(["oak-3", "Oak 4"]);
    const last = await loadMetaobjectPage(s.gql, "swatch", second.next);
    expect(last.next).toBeNull();
    expect(last.items.map((i) => i.id)).toEqual(["gid://shopify/Metaobject/5"]);
  });

  it("lists files with their kind, name and a thumbnail for images", async () => {
    const s = shop();
    const page = await loadFilePage(s.gql);
    expect(page.items.map((i) => [i.kind, i.label])).toEqual([["image", "oak-1.jpg"], ["image", "oak-2.jpg"], ["file", "spec sheet.pdf"], ["video", "hero.mp4"]]);
    expect(page.items[0]!.thumb).toContain("oak-1.jpg");
    expect(page.items[0]!.detail).toBe("Oak top");
    expect(page.items[2]!.detail).toBe("application/pdf");
    expect(page.items[2]!.thumb).toBeNull();
  });

  it("searches by every typed word and by the kinds the metafield accepts", async () => {
    const items = (await loadFilePage(shop().gql)).items;
    expect(filterItems(items, "oak", null)).toHaveLength(2);
    expect(filterItems(items, "oak top", null).map((i) => i.id)).toEqual(["gid://shopify/MediaImage/1"]);
    expect(filterItems(items, "", ["file"]).map((i) => i.label)).toEqual(["spec sheet.pdf"]);
    expect(filterItems(items, "zzz", null)).toEqual([]);
  });

  it("gives saved ids their names, and falls back quietly when a kind cannot be read", async () => {
    const s = shop();
    const ids = ["gid://shopify/Metaobject/1", "gid://shopify/Metaobject/3", "gid://shopify/MediaImage/2", "gid://shopify/Product/1"];
    const labels = await loadPickLabels(s.gql, ids);
    expect(labels).toEqual({ "gid://shopify/Metaobject/1": "Oak 1", "gid://shopify/Metaobject/3": "oak-3", "gid://shopify/MediaImage/2": "oak-2.jpg" });
    s.failOn.set("EditorFileLabels", "throw:Access denied for files");
    const partial = await loadPickLabels(s.gql, ids);
    expect(partial["gid://shopify/Metaobject/1"]).toBe("Oak 1");
    expect(partial["gid://shopify/MediaImage/2"]).toBeUndefined();
  });

  it("loadAllRefLabels asks only for what each query can answer", async () => {
    const s = shop();
    const labels = await loadAllRefLabels(s.gql, ["gid://shopify/Metaobject/1"]);
    expect(labels["gid://shopify/Metaobject/1"]).toBe("Oak 1");
    expect(s.count("EditorRefLabels")).toBe(0); // no product, collection or variant ids, so no call
  });
});

describe("values", () => {
  it("builds, shows and reads back file and metaobject values", () => {
    const labels = { "gid://shopify/MediaImage/1": "oak-1.jpg", "gid://shopify/Metaobject/1": "Oak 1" };
    const one = buildElements("file_reference", { ...emptyDraft("ref-file"), refs: [{ id: "gid://shopify/MediaImage/1", label: "oak-1.jpg" }] });
    expect(one).toEqual({ elements: ["gid://shopify/MediaImage/1"] });
    expect(buildElements("file_reference", emptyDraft("ref-file")).error).toBe("Pick an item.");
    expect(buildElements("file_reference", { ...emptyDraft("ref-file"), refs: [{ id: "a", label: "a" }, { id: "b", label: "b" }] }).error).toBe("Pick only one item.");
    expect(buildElements("list.metaobject_reference", emptyDraft("ref-metaobject")).error).toBe("Pick at least one item.");
    expect(formatValue("file_reference", "gid://shopify/MediaImage/1", labels)).toBe("oak-1.jpg");
    expect(formatValue("list.metaobject_reference", '["gid://shopify/Metaobject/1","gid://shopify/Metaobject/2"]', labels)).toBe("Oak 1, Metaobject 2");
    expect(referenceIds("list.metaobject_reference", '["gid://shopify/Metaobject/1"]')).toEqual(["gid://shopify/Metaobject/1"]);
    expect(draftFromValue("file_reference", "gid://shopify/MediaImage/1", labels).refs).toEqual([{ id: "gid://shopify/MediaImage/1", label: "oak-1.jpg" }]);
  });
  it("fileItem copes with a file that has no name", () => {
    expect(fileItem({ __typename: "GenericFile", id: "g1" }).label).toBe("g1");
  });
});
