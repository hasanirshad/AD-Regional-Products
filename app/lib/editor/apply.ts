// Writing the changes of one product to Shopify. Every call here is a mutation, so it only works inside runUnlocked()
// (the password). The order is fixed, and the first step that fails stops the rest for that product, so a product is
// never left half-done on purpose:
//   1. product fields           (productUpdate)
//   2. the URL handle           (productUpdate, on its own, with an optional redirect)
//   3. variants                 (productVariantsBulkUpdate: price, compare-at, SKU, barcode, tracking, selling rule)
//   4. metafields               (metafieldsSet / metafieldsDelete)
//   5. stock                    (inventorySetQuantities, after tracking is on)
//   6. translations             (translationsRegister / translationsRemove, with digests read AFTER the source text is saved)

import { formatUserErrors, chunks, messageOf, type Gql, type UserError } from "./gql";
import { loadDigests } from "./load";
import { parseSlot } from "./locales";
import { normText, parseNumber, tagsFromValue } from "./canon";
import type { Bundle, Change, Target, Value } from "./model";

export type ChangeStatus = "done" | "failed" | "not applied";
export type ChangeOutcome = { status: ChangeStatus; message: string };

export type ApplyOptions = {
  /** When the URL handle changes, ask Shopify to redirect the old address to the new one. */
  redirectOnHandleChange: boolean;
};

export const DEFAULT_OPTIONS: ApplyOptions = { redirectOnHandleChange: true };

// ---------------------------------------------------------------- mutations

export const PRODUCT_UPDATE = `#graphql
  mutation EditorProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }`;

export const VARIANTS_UPDATE = `#graphql
  mutation EditorVariantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message code }
    }
  }`;

export const METAFIELDS_SET = `#graphql
  mutation EditorMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message code }
    }
  }`;

export const METAFIELDS_DELETE = `#graphql
  mutation EditorMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { ownerId namespace key }
      userErrors { field message }
    }
  }`;

export const STOCK_SET = `#graphql
  mutation EditorStockSet($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message code }
    }
  }`;

export const TRANSLATIONS_REGISTER = `#graphql
  mutation EditorTranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
    translationsRegister(resourceId: $resourceId, translations: $translations) {
      translations { key locale }
      userErrors { field message code }
    }
  }`;

export const TRANSLATIONS_REMOVE = `#graphql
  mutation EditorTranslationsRemove($resourceId: ID!, $translationKeys: [String!]!, $locales: [String!]!, $marketIds: [ID!]) {
    translationsRemove(resourceId: $resourceId, translationKeys: $translationKeys, locales: $locales, marketIds: $marketIds) {
      translations { key locale }
      userErrors { field message code }
    }
  }`;

// ---------------------------------------------------------------- building the inputs (pure)

type ProductChange = Change & { target: Extract<Target, { kind: "product" }> };
type VariantChange = Change & { target: Extract<Target, { kind: "variant" }> };
type MetafieldChange = Change & { target: Extract<Target, { kind: "metafield" }> };
type StockChange = Change & { target: Extract<Target, { kind: "stock" }> };
type TranslationChange = Change & { target: Extract<Target, { kind: "translation" }> };

export function splitChanges(changes: Change[]) {
  return {
    product: changes.filter((c): c is ProductChange => c.target.kind === "product" && c.target.field !== "handle"),
    handle: changes.filter((c): c is ProductChange => c.target.kind === "product" && c.target.field === "handle"),
    variant: changes.filter((c): c is VariantChange => c.target.kind === "variant"),
    metafield: changes.filter((c): c is MetafieldChange => c.target.kind === "metafield"),
    stock: changes.filter((c): c is StockChange => c.target.kind === "stock"),
    translation: changes.filter((c): c is TranslationChange => c.target.kind === "translation"),
  };
}

const text = (v: Value): string => (v ?? "").replace(/\r\n?/g, "\n");

/** The productUpdate input for the product fields (handle is separate). Only changed fields are sent. */
export function productInput(productId: string, changes: ProductChange[]): Record<string, unknown> {
  const input: Record<string, unknown> = { id: productId };
  const seo: Record<string, string> = {};
  for (const c of changes) {
    const after = c.after;
    switch (c.target.field) {
      case "title":
        input.title = text(after).trim();
        break;
      case "descriptionHtml":
        input.descriptionHtml = text(after);
        break;
      case "vendor":
        input.vendor = text(after).trim();
        break;
      case "status":
        input.status = after;
        break;
      case "productType":
        input.productType = text(after).trim();
        break;
      case "category":
        input.category = after;
        break;
      case "tags":
        input.tags = tagsFromValue(after);
        break;
      case "seoTitle":
        seo.title = text(after).trim();
        break;
      case "seoDescription":
        seo.description = text(after).trim();
        break;
    }
  }
  if (Object.keys(seo).length > 0) input.seo = seo;
  return input;
}

/** productVariantsBulkUpdate inputs: one per variant, with only the changed fields. */
export function variantInputs(changes: VariantChange[]): Record<string, unknown>[] {
  const byVariant = new Map<string, Record<string, unknown>>();
  for (const c of changes) {
    const input = byVariant.get(c.target.variantId) ?? { id: c.target.variantId };
    byVariant.set(c.target.variantId, input);
    const item = (input.inventoryItem as Record<string, unknown> | undefined) ?? {};
    switch (c.target.field) {
      case "price":
        input.price = normText(c.after);
        break;
      case "compareAtPrice":
        input.compareAtPrice = normText(c.after) === "" ? null : normText(c.after);
        break;
      case "barcode":
        input.barcode = normText(c.after);
        break;
      case "policy":
        input.inventoryPolicy = c.after;
        break;
      case "sku":
        input.inventoryItem = { ...item, sku: normText(c.after) };
        break;
      case "tracked":
        input.inventoryItem = { ...item, tracked: c.after === "true" };
        break;
    }
  }
  return [...byVariant.values()];
}

// ---------------------------------------------------------------- steps

type PerChange = Map<string, string | null>;

const failAll = (changes: Change[], message: string): PerChange => new Map(changes.map((c) => [c.id, message]));
const okAll = (changes: Change[]): PerChange => new Map(changes.map((c) => [c.id, null]));

async function productStep(gql: Gql, productId: string, changes: ProductChange[]): Promise<PerChange> {
  if (changes.length === 0) return new Map();
  const data = await gql<{ productUpdate: { userErrors: UserError[] } }>(PRODUCT_UPDATE, { product: productInput(productId, changes) });
  const message = formatUserErrors(data.productUpdate.userErrors);
  return message ? failAll(changes, message) : okAll(changes);
}

async function handleStep(gql: Gql, productId: string, changes: ProductChange[], options: ApplyOptions): Promise<PerChange> {
  if (changes.length === 0) return new Map();
  const c = changes[0]!;
  const data = await gql<{ productUpdate: { userErrors: UserError[] } }>(PRODUCT_UPDATE, {
    product: { id: productId, handle: normText(c.after), ...(options.redirectOnHandleChange ? { redirectNewHandle: true } : {}) },
  });
  const message = formatUserErrors(data.productUpdate.userErrors);
  return message ? failAll(changes, message) : okAll(changes);
}

async function variantStep(gql: Gql, productId: string, changes: VariantChange[]): Promise<PerChange> {
  if (changes.length === 0) return new Map();
  const out: PerChange = new Map();
  for (const group of chunks(variantInputs(changes), 100)) {
    const ids = new Set(group.map((g) => g.id as string));
    const mine = changes.filter((c) => ids.has(c.target.variantId));
    const data = await gql<{ productVariantsBulkUpdate: { userErrors: UserError[] } }>(VARIANTS_UPDATE, { productId, variants: group });
    const message = formatUserErrors(data.productVariantsBulkUpdate.userErrors);
    for (const [id, m] of message ? failAll(mine, message) : okAll(mine)) out.set(id, m);
  }
  return out;
}

async function setOne(gql: Gql, c: MetafieldChange): Promise<string | null> {
  const t = c.target;
  const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(METAFIELDS_SET, {
    metafields: [{ ownerId: t.ownerId, namespace: t.namespace, key: t.key, type: t.type, value: c.after as string }],
  });
  return formatUserErrors(data.metafieldsSet.userErrors) || null;
}

async function metafieldStep(gql: Gql, changes: MetafieldChange[]): Promise<PerChange> {
  const out: PerChange = new Map();
  const sets = changes.filter((c) => c.after !== null);
  const deletes = changes.filter((c) => c.after === null);

  for (const group of chunks(sets, 25)) {
    const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(METAFIELDS_SET, {
      metafields: group.map((c) => ({ ownerId: c.target.ownerId, namespace: c.target.namespace, key: c.target.key, type: c.target.type, value: c.after as string })),
    });
    if (!formatUserErrors(data.metafieldsSet.userErrors)) {
      for (const [id, m] of okAll(group)) out.set(id, m);
      continue;
    }
    // One bad value fails the whole call: try them one by one so only the bad one is reported.
    for (const c of group) {
      try {
        out.set(c.id, await setOne(gql, c));
      } catch (e) {
        out.set(c.id, messageOf(e));
      }
    }
  }

  for (const group of chunks(deletes, 25)) {
    const data = await gql<{ metafieldsDelete: { userErrors: UserError[] } }>(METAFIELDS_DELETE, {
      metafields: group.map((c) => ({ ownerId: c.target.ownerId, namespace: c.target.namespace, key: c.target.key })),
    });
    const message = formatUserErrors(data.metafieldsDelete.userErrors);
    for (const [id, m] of message ? failAll(group, message) : okAll(group)) out.set(id, m);
  }
  return out;
}

async function stockStep(gql: Gql, changes: StockChange[]): Promise<PerChange> {
  const out: PerChange = new Map();
  const usable = changes.filter((c) => {
    if (c.before === null) {
      out.set(c.id, "The variant is not stocked at this location. Stock it there in Shopify first.");
      return false;
    }
    return true;
  });
  const quantity = (c: StockChange) => ({
    inventoryItemId: c.target.itemId,
    locationId: c.target.locationId,
    quantity: parseNumber(c.after) ?? 0,
    changeFromQuantity: parseNumber(c.before),
  });
  for (const group of chunks(usable, 100)) {
    const data = await gql<{ inventorySetQuantities: { userErrors: UserError[] } }>(STOCK_SET, {
      input: { name: "available", reason: "correction", quantities: group.map(quantity) },
    });
    if (!formatUserErrors(data.inventorySetQuantities.userErrors)) {
      for (const [id, m] of okAll(group)) out.set(id, m);
      continue;
    }
    for (const c of group) {
      try {
        const one = await gql<{ inventorySetQuantities: { userErrors: UserError[] } }>(STOCK_SET, {
          input: { name: "available", reason: "correction", quantities: [quantity(c)] },
        });
        out.set(c.id, formatUserErrors(one.inventorySetQuantities.userErrors) || null);
      } catch (e) {
        out.set(c.id, messageOf(e));
      }
    }
  }
  return out;
}

const NO_SOURCE = "Shopify has no source text for this field, so it cannot be translated yet. Add the text in the main language and save it first.";

async function translationStep(gql: Gql, changes: TranslationChange[]): Promise<PerChange> {
  const out: PerChange = new Map();
  if (changes.length === 0) return out;
  const adds = changes.filter((c) => normText(c.after) !== "");
  const removes = changes.filter((c) => normText(c.after) === "");

  // The digest of the source text as it is NOW (the source may just have been saved).
  const digests = adds.length > 0 ? await loadDigests(gql, adds.map((c) => c.target.resourceId)) : {};

  const registerGroups = new Map<string, TranslationChange[]>();
  for (const c of adds) {
    const k = `${c.target.resourceId}|${parseSlot(c.target.slot).marketId ?? ""}`;
    registerGroups.set(k, [...(registerGroups.get(k) ?? []), c]);
  }
  const input = (c: TranslationChange) => {
    const { locale, marketId } = parseSlot(c.target.slot);
    return {
      key: c.target.field,
      locale,
      value: c.after as string,
      translatableContentDigest: digests[c.target.resourceId]?.[c.target.field]?.digest ?? "",
      ...(marketId ? { marketId } : {}),
    };
  };
  for (const group of registerGroups.values()) {
    const ready = group.filter((c) => {
      if (!digests[c.target.resourceId]?.[c.target.field]) {
        out.set(c.id, NO_SOURCE);
        return false;
      }
      return true;
    });
    if (ready.length === 0) continue;
    const resourceId = ready[0]!.target.resourceId;
    try {
      const data = await gql<{ translationsRegister: { userErrors: UserError[] } }>(TRANSLATIONS_REGISTER, { resourceId, translations: ready.map(input) });
      const message = formatUserErrors(data.translationsRegister.userErrors);
      if (!message) {
        for (const [id, m] of okAll(ready)) out.set(id, m);
        continue;
      }
      if (ready.length === 1) {
        out.set(ready[0]!.id, message);
        continue;
      }
      for (const c of ready) {
        const one = await gql<{ translationsRegister: { userErrors: UserError[] } }>(TRANSLATIONS_REGISTER, { resourceId, translations: [input(c)] });
        out.set(c.id, formatUserErrors(one.translationsRegister.userErrors) || null);
      }
    } catch (e) {
      for (const c of ready) out.set(c.id, messageOf(e));
    }
  }

  // Removals: one call per resource, field and market, so a field is never removed from a language that was not asked for.
  const removeGroups = new Map<string, TranslationChange[]>();
  for (const c of removes) {
    const k = `${c.target.resourceId}|${c.target.field}|${parseSlot(c.target.slot).marketId ?? ""}`;
    removeGroups.set(k, [...(removeGroups.get(k) ?? []), c]);
  }
  for (const group of removeGroups.values()) {
    const first = group[0]!;
    const marketId = parseSlot(first.target.slot).marketId;
    try {
      const data = await gql<{ translationsRemove: { userErrors: UserError[] } }>(TRANSLATIONS_REMOVE, {
        resourceId: first.target.resourceId,
        translationKeys: [first.target.field],
        locales: group.map((c) => parseSlot(c.target.slot).locale),
        ...(marketId ? { marketIds: [marketId] } : {}),
      });
      const message = formatUserErrors(data.translationsRemove.userErrors);
      for (const [id, m] of message ? failAll(group, message) : okAll(group)) out.set(id, m);
    } catch (e) {
      for (const c of group) out.set(c.id, messageOf(e));
    }
  }
  return out;
}

// ---------------------------------------------------------------- one product

/**
 * Applies the changes of one product. Returns an outcome for every change. Never throws: a step that throws or
 * is refused marks its changes failed, and the steps after it are "not applied".
 */
export async function applyBundle(gql: Gql, bundle: Bundle, options: ApplyOptions = DEFAULT_OPTIONS): Promise<Map<string, ChangeOutcome>> {
  const split = splitChanges(bundle.changes);
  const outcome = new Map<string, ChangeOutcome>();
  let halted: string | null = null;

  const steps: { name: string; changes: Change[]; run: () => Promise<PerChange> }[] = [
    { name: "Product fields", changes: split.product, run: () => productStep(gql, bundle.productId, split.product) },
    { name: "URL handle", changes: split.handle, run: () => handleStep(gql, bundle.productId, split.handle, options) },
    { name: "Variants", changes: split.variant, run: () => variantStep(gql, bundle.productId, split.variant) },
    { name: "Metafields", changes: split.metafield, run: () => metafieldStep(gql, split.metafield) },
    { name: "Stock", changes: split.stock, run: () => stockStep(gql, split.stock) },
    { name: "Translations", changes: split.translation, run: () => translationStep(gql, split.translation) },
  ];

  for (const step of steps) {
    if (step.changes.length === 0) continue;
    if (halted) {
      for (const c of step.changes) outcome.set(c.id, { status: "not applied", message: `Not tried: ${halted}` });
      continue;
    }
    let per: PerChange;
    try {
      per = await step.run();
    } catch (e) {
      per = failAll(step.changes, messageOf(e));
    }
    let failed = 0;
    for (const c of step.changes) {
      const error = per.get(c.id);
      if (error === null) outcome.set(c.id, { status: "done", message: "" });
      else {
        failed++;
        outcome.set(c.id, { status: "failed", message: error ?? "Shopify did not answer for this change." });
      }
    }
    if (failed > 0) halted = `${step.name.toLowerCase()} did not save, so the rest of this product was left alone.`;
  }
  return outcome;
}
