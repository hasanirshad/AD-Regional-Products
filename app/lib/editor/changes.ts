// From pending edits to the review: a list of changes (before and after), the problems that block the review, and the
// warnings that do not. Used by the Edit product page and by Bulk edit. Pure.

import { diffTags, formatPrice, normText, parseNumber, slugify, tagsFromValue } from "./canon";
import { errorEdits, type EditMap } from "./edits";
import {
  PRODUCT_FIELD_LABEL,
  STATUS_LABEL,
  VARIANT_FIELD_LABEL,
  tabOf,
  targetKey,
  TABS,
  type Bundle,
  type Change,
  type Issue,
  type Target,
  type Value,
} from "./model";

/** What the builder needs to know about the products being edited. */
export type ChangeContext = {
  /** The saved value of a target. */
  baseOf: (t: Target) => Value;
  /** The value on screen (pending or saved). */
  effectiveOf: (t: Target) => Value;
  productTitle: (productId: string) => string;
  productHandle: (productId: string) => string;
  variantTitle: (variantId: string) => string;
  slotLabel: (slot: string) => string;
  locationName: (locationId: string) => string;
  metafieldName: (t: Extract<Target, { kind: "metafield" }>) => string;
};

export function labelOf(t: Target, ctx: ChangeContext): string {
  switch (t.kind) {
    case "product":
      return PRODUCT_FIELD_LABEL[t.field];
    case "variant":
      return `${VARIANT_FIELD_LABEL[t.field]} · ${ctx.variantTitle(t.variantId)}`;
    case "metafield": {
      const name = ctx.metafieldName(t);
      return t.ownerKind === "PRODUCT" ? name : `${name} · ${ctx.variantTitle(t.ownerId)}`;
    }
    case "stock":
      return `Available · ${ctx.variantTitle(t.variantId)} · ${ctx.locationName(t.locationId)}`;
    case "translation": {
      const what = t.resource === "metafield" ? `Metafield ${t.field}` : (translationFieldLabel(t.field) ?? t.field);
      return `${ctx.slotLabel(t.slot)} · ${what}`;
    }
  }
}

const TRANSLATION_FIELD_LABEL: Record<string, string> = {
  title: "Title",
  body_html: "Description",
  meta_title: "SEO title",
  meta_description: "SEO description",
  handle: "URL handle",
  product_type: "Product type",
  value: "Value",
};
export const translationFieldLabel = (key: string): string | undefined => TRANSLATION_FIELD_LABEL[key];

const TAB_ORDER = new Map(TABS.map((t, i) => [t.id, i] as const));

export type BuiltChanges = {
  changes: Change[];
  /** Problems that block the review. */
  errors: Issue[];
  /** Things to look at, which do not block. */
  warnings: Issue[];
};

export function buildChanges(edits: EditMap, ctx: ChangeContext): BuiltChanges {
  const changes: Change[] = [];
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  for (const e of errorEdits(edits)) {
    errors.push({ id: targetKey(e.target), message: `${labelOf(e.target, ctx)}: ${e.error}` });
  }

  for (const [id, e] of Object.entries(edits)) {
    if (e.error) continue;
    const target = e.target;
    const change: Change = {
      id,
      target,
      productId: target.productId,
      productTitle: ctx.productTitle(target.productId),
      label: labelOf(target, ctx),
      tab: tabOf(target),
      before: ctx.baseOf(target),
      after: e.value,
    };
    changes.push(change);
    check(change, ctx, errors, warnings);
  }

  changes.sort(
    (a, b) =>
      a.productTitle.localeCompare(b.productTitle) ||
      (TAB_ORDER.get(a.tab) ?? 0) - (TAB_ORDER.get(b.tab) ?? 0) ||
      a.label.localeCompare(b.label),
  );
  return { changes, errors, warnings };
}

/** Field rules, the same on both pages. */
function check(c: Change, ctx: ChangeContext, errors: Issue[], warnings: Issue[]): void {
  const t = c.target;
  const after = c.after;
  const bad = (message: string) => errors.push({ id: c.id, message: `${c.label}: ${message}` });
  const warn = (message: string) => warnings.push({ id: c.id, message: `${c.label}: ${message}` });

  if (t.kind === "product") {
    switch (t.field) {
      case "title":
        if (normText(after) === "") bad("The title cannot be empty.");
        else if (normText(after).length > 255) bad("The title can be 255 characters at most.");
        break;
      case "handle":
        if (normText(after) === "") bad("The URL handle cannot be empty.");
        else if (slugify(normText(after)) !== normText(after)) warn(`Shopify will save this as "${slugify(normText(after))}".`);
        break;
      case "vendor":
        if (normText(after).length > 255) bad("The vendor can be 255 characters at most.");
        break;
      case "status":
        if (!after || !(after in STATUS_LABEL)) bad("Choose active, draft or archived.");
        break;
      case "seoTitle":
        if (normText(after).length > 70) warn("Longer than 70 characters. Search engines usually cut it off.");
        break;
      case "seoDescription":
        if (normText(after).length > 320) warn("Longer than 320 characters. Search engines usually cut it off.");
        break;
      case "tags": {
        const tags = tagsFromValue(after);
        if (tags.length > 250) bad("A product can have 250 tags at most.");
        for (const tag of tags) {
          if (tag.length > 255) bad(`The tag "${tag.slice(0, 20)}…" is longer than 255 characters.`);
          if (tag.includes(",")) bad(`The tag "${tag}" has a comma. Tags cannot contain commas.`);
        }
        break;
      }
      case "productType":
        if (normText(after).length > 255) bad("The product type can be 255 characters at most.");
        break;
    }
    return;
  }

  if (t.kind === "variant") {
    if (t.field === "price") {
      const n = parseNumber(after);
      if (n === null) bad("Enter a price, for example 49.90.");
      else if (n < 0) bad("The price cannot be negative.");
      else {
        const compare = parseNumber(ctx.effectiveOf({ ...t, field: "compareAtPrice" }));
        if (compare !== null && compare > 0 && compare <= n) warn("The compare-at price is not higher than the price, so no sale price will show.");
      }
    } else if (t.field === "compareAtPrice") {
      if (normText(after) !== "") {
        const n = parseNumber(after);
        if (n === null) bad("Enter a price, for example 59.90, or leave it empty.");
        else if (n < 0) bad("The compare-at price cannot be negative.");
        else {
          const price = parseNumber(ctx.effectiveOf({ ...t, field: "price" }));
          if (price !== null && n > 0 && n <= price) warn("Not higher than the price, so no sale price will show.");
        }
      }
    } else if ((t.field === "sku" || t.field === "barcode") && normText(after).length > 255) {
      bad("Can be 255 characters at most.");
    } else if (t.field === "tracked" && after !== "true" && after !== "false") {
      bad("Choose yes or no.");
    } else if (t.field === "policy" && after !== "DENY" && after !== "CONTINUE") {
      bad("Choose stop selling or keep selling.");
    }
    return;
  }

  if (t.kind === "stock") {
    const n = parseNumber(after);
    if (n === null || !Number.isInteger(n)) bad("Enter a whole number.");
    else if (n < 0) bad("The quantity cannot be negative.");
    return;
  }

  // Metafield values are checked when they are typed (mfModel.ts). Translations may be empty (that removes one) and may equal the source.
}

/** Splits the changes into one bundle per product, in the order of the first change. */
export function toBundles(changes: Change[], ctx: Pick<ChangeContext, "productTitle" | "productHandle">): Bundle[] {
  const map = new Map<string, Bundle>();
  for (const c of changes) {
    let b = map.get(c.productId);
    if (!b) {
      b = { productId: c.productId, title: ctx.productTitle(c.productId), handle: ctx.productHandle(c.productId), changes: [] };
      map.set(c.productId, b);
    }
    b.changes.push(c);
  }
  return [...map.values()];
}

/** Counts for the summary line: "7 changes in 3 tabs". */
export function summarize(changes: Change[]): { total: number; tabs: number; products: number; byTab: Map<string, number> } {
  const byTab = new Map<string, number>();
  const products = new Set<string>();
  for (const c of changes) {
    byTab.set(c.tab, (byTab.get(c.tab) ?? 0) + 1);
    products.add(c.productId);
  }
  return { total: changes.length, tabs: byTab.size, products: products.size, byTab };
}

/** Plain lines for a tags change: "Added: a, b · Removed: c". */
export function describeTagChange(before: Value, after: Value): string {
  const { added, removed } = diffTags(tagsFromValue(before), tagsFromValue(after));
  const parts: string[] = [];
  if (added.length) parts.push(`Added: ${added.join(", ")}`);
  if (removed.length) parts.push(`Removed: ${removed.join(", ")}`);
  return parts.join(" · ") || "No change";
}

/** The inverse of a set of changes (for Undo): each change goes back to its `before`. */
export function invertChanges(changes: Change[]): Change[] {
  return changes.map((c) => ({ ...c, before: c.after, after: c.before }));
}

export { formatPrice };

/** The undo record -> the changes that put things back: each item goes from what was saved to what was there before. */
export function undoChanges(items: { target: Target; productId: string; productTitle: string; label: string; before: Value; after: Value }[]): Change[] {
  return items.map((i) => ({
    id: targetKey(i.target),
    target: i.target,
    productId: i.productId,
    productTitle: i.productTitle,
    label: i.label,
    tab: tabOf(i.target),
    before: i.after,
    after: i.before,
  }));
}

/** What the product list should show after these changes were saved (title, handle, vendor, type, status, tags). */
export function rowPatchesFrom(applied: Change[]): Record<string, { title?: string; handle?: string; vendor?: string; productType?: string; status?: string; tags?: string[] }> {
  const out: Record<string, { title?: string; handle?: string; vendor?: string; productType?: string; status?: string; tags?: string[] }> = {};
  for (const c of applied) {
    if (c.target.kind !== "product") continue;
    const patch = (out[c.productId] ??= {});
    const v = c.after ?? "";
    switch (c.target.field) {
      case "title":
        patch.title = v;
        break;
      case "handle":
        patch.handle = slugify(v);
        break;
      case "vendor":
        patch.vendor = v.trim();
        break;
      case "productType":
        patch.productType = v.trim();
        break;
      case "status":
        patch.status = v;
        break;
      case "tags":
        patch.tags = tagsFromValue(c.after);
        break;
    }
  }
  return out;
}
