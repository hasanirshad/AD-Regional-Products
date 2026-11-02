// The last step: for one language, every text of the product with the main-language text on the left and that language
// on the right. Built from what is on screen (saved values plus pending edits), so the review shows what will be saved.
// Metafields of type image or file are never listed (they are not translated). Pure.

import { normText, translationStatus, type TranslationStatus } from "./canon";
import { deferredResourceId } from "./deferred";
import { mfKey, type ProductDoc } from "./doc";
import { translatableMetafield } from "./mfModel";
import type { OptionDraft } from "./optionsPlan";
import type { StepId } from "./productSteps";
import type { Target, Value } from "./model";

export type ReviewRow = {
  key: string;
  step: StepId;
  /** Where the text lives, such as "Option Size" or "SEO". */
  section: string;
  label: string;
  primary: Value;
  /** The text in this language, or null when the text is not translated. */
  translation: Value;
  status: TranslationStatus | "not-translated";
  /** The text holds HTML (a description). */
  html: boolean;
};

/**
 * The translation target of a metafield value, deferred when the metafield has no saved value yet (its id only exists
 * after the value is saved, so the translation is attached to it later in the same run). `owner` is the variant for a
 * variant metafield; without it the product owns the metafield.
 */
export function metafieldTranslationTarget(
  doc: ProductDoc,
  def: { namespace: string; key: string; type: string },
  slot: string,
  owner?: { id: string; savedId: string | null },
): Extract<Target, { kind: "translation" }> {
  const ownerId = owner?.id ?? doc.id;
  const savedId = owner ? owner.savedId : (doc.metafields[mfKey(def.namespace, def.key)]?.id ?? null);
  if (savedId) return { kind: "translation", productId: doc.id, resourceId: savedId, resource: "metafield", field: "value", slot, mfType: def.type };
  const defer = { ownerId, namespace: def.namespace, key: def.key };
  return { kind: "translation", productId: doc.id, resourceId: deferredResourceId(defer), resource: "metafield", field: "value", slot, mfType: def.type, defer };
}

export type ReviewInput = {
  doc: ProductDoc;
  /** The value on screen for a target: the pending edit, or the saved value. */
  effectiveOf: (t: Target) => Value;
  /** Option names and values with the translations typed so far. */
  options: OptionDraft[];
  /** The metafields to list (definitions the product has a value for, or the person filled in), product level only. */
  metafields: { namespace: string; key: string; name: string; type: string; step: StepId }[];
  /** Language names shown in a row, and whether a saved translation is outdated, come from the doc. */
  outdated?: (t: Target) => boolean;
};

const text = (v: Value) => normText(v);

export function reviewRows(input: ReviewInput, slot: string): ReviewRow[] {
  const { doc, effectiveOf } = input;
  const rows: ReviewRow[] = [];
  const outdated = input.outdated ?? ((t: Target) => (t.kind === "translation" ? Boolean(doc.translations[t.resourceId]?.values[t.field]?.[t.slot]?.outdated) : false));

  const add = (r: { key: string; step: StepId; section: string; label: string; primary: Value; target?: Target; html?: boolean; typed?: Value }) => {
    if (!r.target && r.typed === undefined) {
      rows.push({ key: r.key, step: r.step, section: r.section, label: r.label, primary: r.primary, translation: null, status: "not-translated", html: Boolean(r.html) });
      return;
    }
    const translation = r.target ? effectiveOf(r.target) : (r.typed ?? null);
    const status = translationStatus(r.primary, translation, r.target ? outdated(r.target) : false);
    rows.push({ key: r.key, step: r.step, section: r.section, label: r.label, primary: r.primary, translation, status, html: Boolean(r.html) });
  };

  const productText = (field: string, productField: "title" | "descriptionHtml" | "productType" | "seoTitle" | "seoDescription", step: StepId, section: string, label: string, html = false) => {
    const primary = effectiveOf({ kind: "product", productId: doc.id, field: productField });
    add({ key: `p|${field}`, step, section, label, primary, target: { kind: "translation", productId: doc.id, resourceId: doc.id, resource: "product", field, slot }, html });
  };

  productText("title", "title", "info", "Product info", "Title");
  productText("body_html", "descriptionHtml", "info", "Product info", "Description", true);
  productText("product_type", "productType", "info", "Product info", "Product type");

  for (const o of input.options) {
    const optionName = text(o.name);
    if (!optionName) continue;
    add({ key: `o|${o.id ?? optionName}`, step: "variants", section: "Variants", label: `Option name`, primary: optionName, typed: o.tr[slot] ?? null });
    for (const v of o.values) {
      const name = text(v.name);
      if (name) add({ key: `v|${o.id ?? optionName}|${v.id ?? name}`, step: "variants", section: `Variants · ${optionName}`, label: `Value`, primary: name, typed: v.tr[slot] ?? null });
    }
  }

  for (const m of input.metafields) {
    if (!translatableMetafield(m.type)) continue; // images, files, numbers, references: not translated
    const primary = effectiveOf({ kind: "metafield", productId: doc.id, ownerId: doc.id, ownerKind: "PRODUCT", namespace: m.namespace, key: m.key, type: m.type });
    if (text(primary) === "") continue;
    add({ key: `m|${mfKey(m.namespace, m.key)}`, step: m.step, section: "Content", label: m.name, primary, target: metafieldTranslationTarget(doc, m, slot), html: m.type === "rich_text_field" });
  }

  productText("meta_title", "seoTitle", "seo", "SEO", "SEO title");
  productText("meta_description", "seoDescription", "seo", "SEO", "SEO description");
  add({ key: "p|handle", step: "seo", section: "SEO", label: "URL handle (not translated)", primary: effectiveOf({ kind: "product", productId: doc.id, field: "handle" }) });
  return rows;
}

export type ReviewCounts = { total: number; ready: number; missing: number; outdated: number; same: number };

/** For the tab of a language: how many texts still need a translation. Rows that are not translated are not counted. */
export function reviewCounts(rows: ReviewRow[]): ReviewCounts {
  const c: ReviewCounts = { total: 0, ready: 0, missing: 0, outdated: 0, same: 0 };
  for (const r of rows) {
    if (r.status === "not-translated" || r.status === "no-source") continue;
    c.total++;
    if (r.status === "missing") c.missing++;
    else if (r.status === "outdated") c.outdated++;
    else if (r.status === "same") c.same++;
    else c.ready++;
  }
  return c;
}
