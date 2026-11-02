import { describe, expect, it } from "vitest";
import { chooserDefinitions, fold, matches, placeDefinitions, GROUPS, leftoverStepOf, splitLeftovers, stepOfMetafield, subOfMetafield, type DefLike } from "./curated";
import { firstSub, normalizeStep, stepAfter, STEPS } from "./productSteps";

const d = (name: string, type = "single_line_text_field", ownerKind: DefLike["ownerKind"] = "PRODUCT", key = fold(name).replace(/ /g, "_")): DefLike => ({ namespace: "custom", key, name, type, ownerKind });
const names = (p: { defs: DefLike[] }[]) => p.flatMap((x) => x.defs.map((y) => y.name));

describe("variant metafields", () => {
  const defs = [
    d("Top Thickness", "dimension", "PRODUCTVARIANT"), d("Mattress Length", "dimension", "PRODUCTVARIANT"), d("Mattress Width", "dimension", "PRODUCTVARIANT"), d("Headboard Height", "dimension", "PRODUCTVARIANT"),
    d("Variant table person space", "number_integer", "PRODUCTVARIANT"), d("Variant width", "dimension", "PRODUCTVARIANT"), d("Variant Length", "dimension", "PRODUCTVARIANT"), d("Variant height", "dimension", "PRODUCTVARIANT"),
    d("Swatches", "list.metaobject_reference", "PRODUCTVARIANT"), d("Hide From Markets", "list.single_line_text_field", "PRODUCTVARIANT"), d("Something else", "single_line_text_field", "PRODUCTVARIANT"),
  ];
  it("splits sizes from swatches and visibility", () => {
    expect(names(placeDefinitions(defs, "variantOptions", "sizes"))).toEqual(["Top Thickness", "Mattress Length", "Mattress Width", "Headboard Height", "Variant table person space", "Variant width", "Variant Length", "Variant height"]);
    expect(names(placeDefinitions(defs, "variantOptions", "swatches"))).toEqual(["Swatches", "Hide From Markets"]);
  });
  it("leaves an unknown metafield to the chooser", () => {
    const shown = new Set(placeDefinitions(defs, "variantOptions").flatMap((p) => p.defs.map((x) => `${x.ownerKind}|${x.namespace}.${x.key}`)));
    expect(chooserDefinitions(defs, "variantOptions", shown).map((x) => x.name)).toEqual(["Something else"]);
  });
  it("does not mix owners: a product metafield never appears on a variant screen", () => {
    expect(names(placeDefinitions([d("Width"), d("Swatches")], "variantOptions"))).toEqual([]);
  });
});

describe("product metafields", () => {
  const defs = [
    d("Tag line"), d("Wood type"), d("Material section"), d("Dimensions section"), d("Description image", "file_reference"), d("Specs PDF", "file_reference"), d("Hero video", "file_reference"),
    d("Stock delivery"), d("Production time"), d("Build and Delivery time"), d("Related products", "list.product_reference"), d("Infinity recommended products", "list.product_reference"),
    d("Bundle options", "list.metaobject_reference"), d("Required options", "list.metaobject_reference"), d("Relationship status"),
  ];
  it("puts texts on Content, and never files or delivery fields", () => {
    expect(names(placeDefinitions(defs, "content"))).toEqual(["Tag line", "Wood type", "Material section", "Dimensions section"]);
  });
  it("lead times: delivery and production, but never 'Build and Delivery time'", () => {
    expect(names(placeDefinitions(defs, "leadTimes"))).toEqual(["Stock delivery", "Production time"]);
    expect(chooserDefinitions(defs, "productOptions", new Set()).map((x) => x.name)).not.toContain("Build and Delivery time");
    expect(chooserDefinitions(defs, "content", new Set()).map((x) => x.name)).not.toContain("Build and Delivery time");
  });
  it("related and options are separate sub-tabs", () => {
    expect(names(placeDefinitions(defs, "productOptions", "related"))).toEqual(["Related products", "Infinity recommended products"]);
    expect(names(placeDefinitions(defs, "productOptions", "options"))).toEqual(["Bundle options", "Required options"]);
  });
  it("files: images and documents are told apart", () => {
    const placed = placeDefinitions(defs, "files");
    expect(placed.map((p) => [p.group.id, p.defs.map((x) => x.name)])).toEqual([["images", ["Description image", "Hero video"]], ["documents", ["Specs PDF"]]]);
  });
  it("matches words by their start, so 'ship' is not found in 'Relationship'", () => {
    const g = GROUPS.find((x) => x.id === "leadTimes")!;
    expect(matches(g, d("Relationship status"))).toBe(false);
    expect(matches(g, d("Shipping notes"))).toBe(true);
  });
  it("each metafield appears in one group only", () => {
    for (const x of defs) expect(GROUPS.filter((g) => matches(g, x)).length).toBeGreaterThanOrEqual(0);
    const all = GROUPS.flatMap((g) => placeDefinitions(defs, g.step, g.sub).filter((p) => p.group.id === g.id).flatMap((p) => p.defs.map((y) => y.name)));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("steps", () => {
  it("has the eleven steps with Review last and Images before Publishing", () => {
    expect(STEPS.map((s) => s.id)).toEqual(["info", "variants", "inventory", "variantOptions", "productOptions", "content", "leadTimes", "seo", "files", "publishing", "review"]);
  });
  it("moves between steps and stops at the ends", () => {
    expect(stepAfter("info")).toBe("variants");
    expect(stepAfter("info", -1)).toBe("info");
    expect(stepAfter("review")).toBe("review");
  });
  it("maps the old draft step ids to the new ones", () => {
    expect(normalizeStep("basics")).toBe("info");
    expect(normalizeStep("prices")).toBe("inventory");
    expect(normalizeStep("metafields")).toBe("productOptions");
    expect(normalizeStep("seo")).toBe("seo");
    expect(normalizeStep("nonsense")).toBeNull();
    expect(normalizeStep(3)).toBeNull();
  });
  it("two steps are split in two screens", () => {
    expect(firstSub("variantOptions")).toBe("sizes");
    expect(firstSub("productOptions")).toBe("options");
    expect(firstSub("info")).toBeNull();
  });
});

describe("leftovers: what no group claims", () => {
  const defs = [d("Pattern code"), d("Floor plan", "file_reference"), d("Partner link", "list.product_reference"), d("Top Thickness", "dimension", "PRODUCTVARIANT"), d("Odd one", "number_integer", "PRODUCTVARIANT"), d("Build and Delivery time")];
  it("goes to one step by type", () => {
    expect(leftoverStepOf(d("Notes x", "multi_line_text_field"))).toBe("content");
    expect(leftoverStepOf(d("X", "file_reference"))).toBe("files");
    expect(leftoverStepOf(d("X", "product_reference"))).toBe("productOptions");
    expect(leftoverStepOf(d("X", "boolean"))).toBe("productOptions");
    expect(leftoverStepOf(d("X", "number_integer", "PRODUCTVARIANT"))).toBe("variantOptions");
  });
  it("shows the ones with a value and offers the others", () => {
    const has = (x: DefLike) => x.name === "Pattern code" || x.name === "Partner link";
    expect(splitLeftovers(defs, "content", has).valued.map((x) => x.name)).toEqual(["Pattern code"]);
    expect(splitLeftovers(defs, "productOptions", has).valued.map((x) => x.name)).toEqual(["Partner link"]);
    expect(splitLeftovers(defs, "files", has).empty.map((x) => x.name)).toEqual(["Floor plan"]);
    expect(splitLeftovers(defs, "variantOptions", has).empty.map((x) => x.name)).toEqual(["Odd one"]);
  });
  it("knows the step and sub-tab of any metafield", () => {
    expect(stepOfMetafield(d("Top Thickness", "dimension", "PRODUCTVARIANT"))).toBe("variantOptions");
    expect(subOfMetafield(d("Swatches", "list.metaobject_reference", "PRODUCTVARIANT"))).toBe("swatches");
    expect(stepOfMetafield(d("Tag line"))).toBe("content");
    expect(stepOfMetafield(d("Stock delivery"))).toBe("leadTimes");
    expect(subOfMetafield(d("Related products", "list.product_reference"))).toBe("related");
    expect(subOfMetafield(d("Tag line"))).toBeNull();
  });
});
