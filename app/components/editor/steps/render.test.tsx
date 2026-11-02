// A smoke render of each Product Edits step on the server (no browser): it catches screens that throw while drawing,
// with a product read from the fake store. Effects do not run here, so this checks the first paint of each screen.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { baseOf, type ProductDoc } from "../../../lib/editor/doc";
import { fakeProduct, fakeVariant, FakeShopify, LOC_A } from "../../../lib/editor/fake";
import { loadDefinitions, loadProductDoc, loadShopInfo } from "../../../lib/editor/load";
import { loadOptionDrafts, type OptionDraft } from "../../../lib/editor/optionsPlan";
import { slotsWithAdaptations } from "../../../lib/editor/locales";
import type { EditState } from "../../../views/edit-state";
import type { EditorShared } from "../../../views/editor-state";
import { CuratedStep } from "./CuratedStep";
import { InfoStep } from "./InfoStep";
import { InventoryStep } from "./InventoryStep";
import { ReviewStep } from "./ReviewStep";
import { SeoStep } from "./SeoStep";
import { StepFooter } from "./StepFooter";
import { StepStrip } from "./StepStrip";
import { VariantsStep } from "./VariantsStep";

const P = "gid://shopify/Product/1";
const lazy = <T,>(data: T) => ({ status: "ready" as const, data, error: "", load: () => undefined, reload: () => undefined, set: () => undefined });

async function setup(opts: { options?: boolean; draft?: boolean } = {}) {
  const shop = new FakeShopify([
    fakeProduct(P, {
      status: opts.draft ? "DRAFT" : "ACTIVE",
      options: opts.options ? [{ name: "Size", values: ["180 cm", "220 cm"], id: "o1", valueIds: ["ov1", "ov2"] }] : [],
      variants: opts.options
        ? [fakeVariant("v1", { selectedOptions: [{ name: "Size", value: "180 cm" }], levels: {} }), fakeVariant("v2", { position: 2, selectedOptions: [{ name: "Size", value: "220 cm" }], levels: { [LOC_A]: 2 } })]
        : [fakeVariant("v0", { levels: {} })],
      metafields: { "custom.tag_line": { id: "gid://shopify/Metafield/9", type: "single_line_text_field", value: "Solid oak" } },
    }),
  ]);
  shop.locations = [{ id: LOC_A, name: "Hardman Möbel Ltd. | London" }, { id: "gid://shopify/Location/2", name: "Berlin" }];
  const defs = (ownerType: string, list: [string, string, string][]) => list.forEach(([key, name, type], i) => shop.definitions.push({ id: `d${ownerType}${i}`, ownerType, namespace: "custom", key, name, type: { name: type } }));
  defs("PRODUCT", [
    ["tag_line", "Tag line", "single_line_text_field"],
    ["wood", "Wood type", "single_line_text_field"],
    ["stock_delivery", "Stock delivery", "single_line_text_field"],
    ["delivery_weeks", "Delivery weeks", "number_integer"],
    ["required_options", "Required options", "list.product_reference"],
    ["related", "Related products", "list.product_reference"],
    ["spec_pdf", "Specs PDF", "file_reference"],
    ["image_one", "Image 1", "file_reference"],
    ["odd", "Odd note", "multi_line_text_field"],
  ]);
  defs("PRODUCTVARIANT", [
    ["top_thickness", "Top Thickness", "number_integer"],
    ["variant_width", "Variant width", "dimension"],
    ["hide_from_markets", "Hide From Markets", "list.single_line_text_field"],
    ["swatch", "Swatch", "color"],
  ]);
  const info = await loadShopInfo(shop.gql);
  const slots = slotsWithAdaptations(info.locales, [], null);
  const doc: ProductDoc = await loadProductDoc(shop.gql, P, slots.map((s) => s.key));
  const productDefs = await loadDefinitions(shop.gql, "PRODUCT");
  const variantDefs = await loadDefinitions(shop.gql, "PRODUCTVARIANT");
  const base: OptionDraft[] = await loadOptionDrafts(shop.gql, doc, slots.map((s) => s.key));
  const shared = { info: lazy(info), productDefs: lazy(productDefs), variantDefs: lazy(variantDefs), settings: lazy(null), slots, ready: true, undo: null, setUndo: () => undefined } as unknown as EditorShared;
  const nothing = () => undefined;
  const edit = {
    productId: P, doc, docs: { [P]: doc }, loading: false, error: "", open: async () => undefined, close: nothing, refresh: async () => undefined,
    edits: {}, put: nothing, drafts: {}, putDrafts: nothing, baseValue: (t: never) => baseOf(doc, t), effectiveValue: (t: never) => baseOf(doc, t),
    discard: nothing, discardAll: nothing, built: { changes: [], errors: [], warnings: [] }, ctx: {},
    entry: opts.draft ? "create" : "edit", setEntry: nothing, step: "info", sub: null, setSub: nothing, go: nothing, stepOf: () => "info", stockKinds: {}, setStockKind: nothing,
    options: { base, draft: structuredClone(base), setDraft: nothing, reload: async () => undefined, error: "" },
    chosen: { product: [], variant: [] }, setChosen: nothing, labels: {}, addLabels: nothing, mode: "edit", setMode: nothing,
  } as unknown as EditState;
  return { edit, shared, doc };
}

describe("Product Edits steps draw", () => {
  it("Product info, SEO", async () => {
    const { edit, shared, doc } = await setup();
    const html = renderToString(<InfoStep edit={edit} shared={shared} doc={doc} />) + renderToString(<SeoStep edit={edit} shared={shared} doc={doc} />);
    expect(html).toContain("Product info");
    expect(html).toContain("Made to order");
  });

  it("Variants with and without options", async () => {
    for (const options of [false, true]) {
      const { edit, shared, doc } = await setup({ options });
      const html = renderToString(<VariantsStep edit={edit} shared={shared} doc={doc} running={false} setRunning={() => undefined} onSaved={() => undefined} />);
      expect(html).toContain("Variants");
      if (options) {
        expect(html).toContain("180 cm");
        expect(html).toContain("Add another option");
      } else expect(html).toContain("Add the first option");
    }
  });

  it("Inventory names each variant by its options", async () => {
    const { edit, shared, doc } = await setup({ options: true, draft: true });
    const html = renderToString(<InventoryStep edit={edit} shared={shared} doc={doc} />);
    expect(html).toContain("180 cm");
    expect(html).toContain("CAP (compare-at price)");
    expect(html).toContain("Sale price");
    expect(html).toContain("Hardman Möbel Ltd. | London");
  });

  it("every metafield step", async () => {
    const { edit, shared, doc } = await setup({ options: true });
    const out: Record<string, string> = {};
    for (const [step, sub] of [["variantOptions", "sizes"], ["variantOptions", "swatches"], ["productOptions", "options"], ["productOptions", "related"], ["content", null], ["leadTimes", null], ["files", null]] as const) {
      const e = { ...edit, step, sub } as EditState;
      out[`${step}/${sub}`] = renderToString(<CuratedStep edit={e} shared={shared} doc={doc} step={step} />);
    }
    expect(out["variantOptions/sizes"]).toContain("Top Thickness");
    expect(out["variantOptions/swatches"]).toContain("Hide From Markets");
    expect(out["productOptions/options"]).toContain("Required options");
    expect(out["productOptions/related"]).toContain("Related products");
    expect(out["content/null"]).toContain("Tag line");
    expect(out["leadTimes/null"]).toContain("Delivery weeks");
    expect(out["files/null"]).toContain("Specs PDF");
  });

  it("Review and the strip", async () => {
    const { edit, shared, doc } = await setup({ options: true });
    const html = renderToString(<ReviewStep edit={edit} shared={shared} doc={doc} />);
    expect(html).toContain("French");
    expect(html).toContain("Review changes and save");
    expect(renderToString(<StepStrip current="info" counts={{ info: 2 }} onGo={() => undefined} />)).toContain("Product info");
    expect(renderToString(<StepFooter step="info" waiting={1} blocked={false} onBack={() => undefined} onSaveNext={() => undefined} />)).toContain("Save and next");
  });
});
