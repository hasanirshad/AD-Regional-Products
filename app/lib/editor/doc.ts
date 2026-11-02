// A product as the editor holds it after reading it from Shopify, and how to look up the saved value of any target.
// Pure.

import { rememberCategory, tagsToValue } from "./canon";
import type { Target, Value } from "./model";

export type MetafieldDoc = { id: string; value: string; type: string; digest: string | null };

export type StockLevelDoc = { locationId: string; quantity: number; /** The inventory level id (needed to remove a location). */ id?: string };

export type VariantDoc = {
  id: string;
  title: string;
  position: number;
  options: { name: string; value: string }[];
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
  barcode: string | null;
  policy: "DENY" | "CONTINUE";
  tracked: boolean;
  itemId: string;
  levels: StockLevelDoc[];
  /** "namespace.key" -> the metafield, or null when it was read and the variant has none. A key that is missing was not read yet. */
  metafields: Record<string, MetafieldDoc | null>;
};

export type TranslationRes = {
  /** Shopify's translatable content: the source text and the digest a translation must quote. */
  content: Record<string, { value: string; digest: string }>;
  /** field -> slot -> the saved translation. */
  values: Record<string, Record<string, { value: string; outdated: boolean }>>;
};

export type OptionDoc = {
  /** Shopify's option id (absent only in old test data). */
  id: string;
  name: string;
  position: number;
  values: string[];
  /** The ids of the values, in the same order as `values`. */
  valueIds: string[];
};

export type ProductDoc = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string;
  status: string;
  seoTitle: string;
  seoDescription: string;
  productType: string;
  category: { id: string; name: string } | null;
  tags: string[];
  options: OptionDoc[];
  /** The product's theme template suffix ("" = the default template). */
  templateSuffix: string;
  /** Shopify's preview link for the product (works for a draft, for people signed in to the admin). */
  previewUrl: string | null;
  /** Ids of every publication (sales channel or market catalogue) the product is published to. */
  publicationIds: string[];
  variants: VariantDoc[];
  /** True when the product has more variants than were read. */
  variantsTruncated: boolean;
  variantCount: number;
  /** All the product's metafields, by "namespace.key". */
  metafields: Record<string, MetafieldDoc>;
  /** By resource gid (the product, or one of its metafields). */
  translations: Record<string, TranslationRes>;
};

export const mfKey = (namespace: string, key: string): string => `${namespace}.${key}`;

export function variantOf(doc: ProductDoc, variantId: string): VariantDoc | undefined {
  return doc.variants.find((v) => v.id === variantId);
}

/** The variant's name in lists: its option values, or "Default" for a product with no options. */
export function variantTitle(v: VariantDoc): string {
  const name = v.options.map((o) => o.value).join(" / ");
  return name && name !== "Default Title" ? name : v.title && v.title !== "Default Title" ? v.title : "Default variant";
}

export const productTextOf = (doc: ProductDoc, field: string): string => {
  switch (field) {
    case "title":
      return doc.title;
    case "body_html":
      return doc.descriptionHtml;
    case "meta_title":
      return doc.seoTitle;
    case "meta_description":
      return doc.seoDescription;
    case "handle":
      return doc.handle;
    case "product_type":
      return doc.productType;
    default:
      return "";
  }
};

/** The saved value of a target. */
export function baseOf(doc: ProductDoc, t: Target): Value {
  switch (t.kind) {
    case "product":
      switch (t.field) {
        case "title":
          return doc.title;
        case "descriptionHtml":
          return doc.descriptionHtml || null;
        case "vendor":
          return doc.vendor || null;
        case "status":
          return doc.status;
        case "seoTitle":
          return doc.seoTitle || null;
        case "seoDescription":
          return doc.seoDescription || null;
        case "handle":
          return doc.handle;
        case "productType":
          return doc.productType || null;
        case "category":
          return doc.category?.id ?? null;
        case "tags":
          return tagsToValue(doc.tags);
        case "templateSuffix":
          return doc.templateSuffix || null;
      }
      return null;
    case "variant": {
      const v = variantOf(doc, t.variantId);
      if (!v) return null;
      switch (t.field) {
        case "price":
          return v.price;
        case "compareAtPrice":
          return v.compareAtPrice;
        case "sku":
          return v.sku;
        case "barcode":
          return v.barcode;
        case "tracked":
          return String(v.tracked);
        case "policy":
          return v.policy;
      }
      return null;
    }
    case "metafield": {
      if (t.ownerKind === "PRODUCT") return doc.metafields[mfKey(t.namespace, t.key)]?.value ?? null;
      const v = variantOf(doc, t.ownerId);
      return v?.metafields[mfKey(t.namespace, t.key)]?.value ?? null;
    }
    case "stock": {
      const v = variantOf(doc, t.variantId);
      const level = v?.levels.find((l) => l.locationId === t.locationId);
      return level ? String(level.quantity) : null;
    }
    case "publish":
      return String(doc.publicationIds.includes(t.publicationId));
    case "translation":
      return doc.translations[t.resourceId]?.values[t.field]?.[t.slot]?.value ?? null;
  }
}

/** Remembers the category name so it can be shown. */
export function noteCategory(doc: ProductDoc): void {
  if (doc.category) rememberCategory(doc.category.id, doc.category.name);
}
