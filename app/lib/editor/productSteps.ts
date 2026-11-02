import type { Target } from "./model";

// The steps of Product Edits. The same steps are used to create a product and to edit one; the strip at the top lets a
// person jump to any of them at any time. Pure: no Shopify, no screen.

export type StepId = "info" | "variants" | "inventory" | "variantOptions" | "productOptions" | "content" | "leadTimes" | "seo" | "files" | "publishing" | "review";

export type SubTab = { id: string; label: string; hint: string };

export type StepInfo = {
  id: StepId;
  /** The name in the strip. */
  label: string;
  /** One line under the step title: what the person does here. */
  hint: string;
  /** Some steps are split in two screens to keep each one focused. */
  subtabs?: SubTab[];
  /** The step has text that is translated next to the main text. */
  translates: boolean;
};

export const STEPS: StepInfo[] = [
  { id: "info", label: "Product info", hint: "Title, description, type, vendor, page template and whether it is kept in stock or made to order.", translates: true },
  { id: "variants", label: "Variants", hint: "Up to three options, such as Size or Colour, with their values and the order they show in on the product page.", translates: true },
  { id: "inventory", label: "Inventory & prices", hint: "Stock or made to order, locations and quantities, SKU, and the CAP the sale price follows.", translates: false },
  {
    id: "variantOptions",
    label: "Variant details",
    hint: "Details that belong to each variant.",
    translates: false,
    subtabs: [
      { id: "sizes", label: "Sizes & dimensions", hint: "Thickness, mattress and headboard sizes, table space and the width, length and height of each variant." },
      { id: "swatches", label: "Swatches & visibility", hint: "Swatches, and the markets a variant is hidden from." },
    ],
  },
  {
    id: "productOptions",
    label: "Product options",
    hint: "What a customer can add or choose on this product.",
    translates: false,
    subtabs: [
      { id: "options", label: "Options & customisation", hint: "Required options, bundle options and infinity options." },
      { id: "related", label: "Related & recommended", hint: "Related products and recommendations." },
    ],
  },
  { id: "content", label: "Content", hint: "Texts for the product page: tag line, material, dimensions, wood type. Each text has its translations beside it.", translates: true },
  { id: "leadTimes", label: "Lead times", hint: "Delivery and production times. These are not translated.", translates: false },
  { id: "seo", label: "SEO", hint: "Search title and description, with translations, and the URL handle.", translates: true },
  { id: "files", label: "Images & files", hint: "Images, videos and documents attached to the product. These are not translated.", translates: false },
  { id: "publishing", label: "Publishing", hint: "The sales channels and market catalogues the product is published to.", translates: false },
  { id: "review", label: "Review", hint: "Read every language next to the main text, then review the changes and save as a draft.", translates: true },
];

export const STEP_IDS: StepId[] = STEPS.map((s) => s.id);
export const stepInfo = (id: StepId): StepInfo => STEPS.find((s) => s.id === id)!;
export const stepIndex = (id: StepId): number => STEPS.findIndex((s) => s.id === id);

/** The step after (or before) this one; stays on the last (or first) step at the ends. */
export function stepAfter(id: StepId, by = 1): StepId {
  const i = Math.min(STEPS.length - 1, Math.max(0, stepIndex(id) + by));
  return STEPS[i]!.id;
}

/** Draft products saved before Product Edits used these step ids. They are mapped to the closest new step. */
const LEGACY: Record<string, StepId> = { basics: "info", seo: "seo", metafields: "productOptions", variants: "variants", type: "info", tags: "info", prices: "inventory" };

export function normalizeStep(raw: unknown): StepId | null {
  if (typeof raw !== "string") return null;
  if ((STEP_IDS as string[]).includes(raw)) return raw as StepId;
  return LEGACY[raw] ?? null;
}

/** First sub-tab of a step, if it has any. */
export const firstSub = (id: StepId): string | null => stepInfo(id).subtabs?.[0]?.id ?? null;

/** A product starts in "made to order" or "stock". The PDP templates are the theme's; "made-to-order" is only a suggestion. */
export type StockKind = "stock" | "made_to_order";
export const STOCK_KIND_LABEL: Record<StockKind, string> = { stock: "In stock", made_to_order: "Made to order" };

/**
 * The step an edit belongs to, for the count on each step in the strip and for "go to the field". The step of a
 * metafield (or of the translation of one) depends on which screen shows it, so the page passes that in.
 */
export function stepOfTarget(t: Target, metafieldStep: (t: Target) => StepId): StepId {
  switch (t.kind) {
    case "product":
      return t.field === "seoTitle" || t.field === "seoDescription" || t.field === "handle" ? "seo" : "info";
    case "variant":
    case "stock":
      return "inventory";
    case "publish":
      return "publishing";
    case "metafield":
      return metafieldStep(t);
    case "translation":
      if (t.resource === "option" || t.resource === "optionValue") return "variants";
      if (t.resource === "metafield") return metafieldStep(t);
      return t.field === "meta_title" || t.field === "meta_description" || t.field === "handle" ? "seo" : "info";
  }
}
