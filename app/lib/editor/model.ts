// The Product Editor's data model. Pure types and small helpers, shared by the Edit product page and Bulk edit.
//
// Everything the editor can change is a TARGET (one field of one thing). A pending edit is the END STATE wanted for a
// target; a CHANGE is a target with the value it has now (`before`) and the value wanted (`after`). Both pages build
// changes, show them in one review, and apply them with the same code (apply.ts).

import type { OwnerKind } from "./mfTypes";

/** Every stored value is text, or null for "nothing there". Numbers, booleans and lists use the text Shopify stores. */
export type Value = string | null;

export type ProductField =
  | "title"
  | "descriptionHtml"
  | "vendor"
  | "status"
  | "seoTitle"
  | "seoDescription"
  | "handle"
  | "productType"
  | "category"
  | "tags";

export type VariantField = "price" | "compareAtPrice" | "sku" | "barcode" | "tracked" | "policy";

export type Target =
  | { kind: "product"; productId: string; field: ProductField }
  | { kind: "variant"; productId: string; variantId: string; field: VariantField }
  | {
      kind: "metafield";
      productId: string;
      /** The product or the variant that owns the metafield. */
      ownerId: string;
      ownerKind: OwnerKind;
      namespace: string;
      key: string;
      type: string;
    }
  | { kind: "stock"; productId: string; variantId: string; itemId: string; locationId: string }
  | {
      kind: "translation";
      productId: string;
      /** The product gid, or the metafield gid. */
      resourceId: string;
      resource: "product" | "metafield";
      /** Shopify's translatable key: title, body_html, meta_title, meta_description, handle, product_type, or value (a metafield). */
      field: string;
      /** A language code, or a language and a market (see locales.ts). */
      slot: string;
      /** For a metafield translation: its type, so rich text can be shown as markup. */
      mfType?: string;
    };

/** A stable text name for a target. Used as the key of pending edits and changes. */
export function targetKey(t: Target): string {
  switch (t.kind) {
    case "product":
      return `p|${t.productId}|${t.field}`;
    case "variant":
      return `v|${t.variantId}|${t.field}`;
    case "metafield":
      return `m|${t.ownerId}|${t.namespace}.${t.key}`;
    case "stock":
      return `s|${t.variantId}|${t.locationId}`;
    case "translation":
      return `t|${t.resourceId}|${t.field}|${t.slot}`;
  }
}

export type TabId = "basic" | "seo" | "productMeta" | "variantMeta" | "type" | "inventory" | "tags" | "prices";

export const TABS: { id: TabId; label: string }[] = [
  { id: "basic", label: "Basic data" },
  { id: "seo", label: "SEO" },
  { id: "productMeta", label: "Product metafields" },
  { id: "variantMeta", label: "Variant metafields" },
  { id: "type", label: "Type and category" },
  { id: "inventory", label: "Inventory" },
  { id: "tags", label: "Tags" },
  { id: "prices", label: "Prices" },
];

export const tabLabel = (id: TabId): string => TABS.find((t) => t.id === id)?.label ?? id;

/** Which tab a target is edited on. */
export function tabOf(t: Target): TabId {
  switch (t.kind) {
    case "product":
      switch (t.field) {
        case "title":
        case "descriptionHtml":
        case "vendor":
        case "status":
          return "basic";
        case "seoTitle":
        case "seoDescription":
        case "handle":
          return "seo";
        case "productType":
        case "category":
          return "type";
        case "tags":
          return "tags";
      }
      return "basic";
    case "variant":
      return t.field === "price" || t.field === "compareAtPrice" ? "prices" : "inventory";
    case "stock":
      return "inventory";
    case "metafield":
      return t.ownerKind === "PRODUCT" ? "productMeta" : "variantMeta";
    case "translation":
      if (t.resource === "metafield") return "productMeta";
      switch (t.field) {
        case "title":
        case "body_html":
          return "basic";
        case "meta_title":
        case "meta_description":
        case "handle":
          return "seo";
        default:
          return "type";
      }
  }
}

/** The translatable key Shopify uses for each product field. Fields not listed cannot be translated. */
export const PRODUCT_TRANSLATION_KEY: Partial<Record<ProductField, string>> = {
  title: "title",
  descriptionHtml: "body_html",
  seoTitle: "meta_title",
  seoDescription: "meta_description",
  handle: "handle",
  productType: "product_type",
};

export const PRODUCT_FIELD_LABEL: Record<ProductField, string> = {
  title: "Title",
  descriptionHtml: "Description",
  vendor: "Vendor",
  status: "Status",
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  handle: "URL handle",
  productType: "Product type",
  category: "Category",
  tags: "Tags",
};

export const VARIANT_FIELD_LABEL: Record<VariantField, string> = {
  price: "Price",
  compareAtPrice: "Compare-at price",
  sku: "SKU",
  barcode: "Barcode",
  tracked: "Track quantity",
  policy: "Continue selling when out of stock",
};

export type Change = {
  /** The target key. */
  id: string;
  target: Target;
  productId: string;
  productTitle: string;
  /** Plain label, for example "Title", "French · Title", "Price · Oak / 180 cm". */
  label: string;
  tab: TabId;
  before: Value;
  after: Value;
};

/** All the changes for one product. This is one "line" of a run (RunFlow tries the first line alone, then the rest). */
export type Bundle = {
  productId: string;
  title: string;
  handle: string;
  changes: Change[];
};

export type Issue = { id: string | null; message: string };

export const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };

export const gidNumber = (gid: string): string => /(\d+)(?:\?.*)?$/.exec(gid)?.[1] ?? gid;
