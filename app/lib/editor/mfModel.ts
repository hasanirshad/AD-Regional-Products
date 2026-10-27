// Metafield rows in the editor: which types can be edited here, and how the boxes on screen (drafts) become the
// value Shopify stores. This is the "type-aware validation": it runs on every change, so the row shows its error at
// once and the review is blocked until every row is valid. Pure.
//
// A row has a list of DRAFTS (what is typed or picked). A single value has one draft. A list has one draft per item,
// except reference lists, which keep all picks in one draft (`refs`). A boolean keeps "true", "false" or "" (not set)
// in `draft.text`.

import {
  baseType,
  buildElements,
  draftFromValue,
  elementToString,
  emptyDraft,
  encodeValue,
  inputKindOf,
  isListType,
  parseValue,
  richTextEditable,
  type Draft,
  type Element,
  type InputKind,
  type PickedRef,
} from "./mfTypes";
import { checkRules, type Validation } from "./mfRules";
import type { Value } from "./model";

export type Support = { editable: true } | { editable: false; reason: string };

const READONLY_REASON: Record<string, string> = {
  file_reference: "Files and images are media. This app does not handle media, so the value is shown read-only.",
  metaobject_reference: "Metaobject entries are not edited in this app. Change this one in Shopify.",
  mixed_reference: "Metaobject entries are not edited in this app. Change this one in Shopify.",
  page_reference: "Pages are not picked in this app. Change this one in Shopify.",
  article_reference: "Articles are not picked in this app. Change this one in Shopify.",
  customer_reference: "Customers are not picked in this app. Change this one in Shopify.",
  company_reference: "Companies are not picked in this app. Change this one in Shopify.",
};

/** Can this type be edited here? Types that cannot are still shown, read-only, with the reason. */
export function supportOf(type: string): Support {
  const base = baseType(type);
  if (READONLY_REASON[base]) return { editable: false, reason: READONLY_REASON[base] };
  const kind = inputKindOf(type);
  if (kind === "unsupported" || kind === "ref-metaobject") return { editable: false, reason: "This type is not edited in this app. Change it in Shopify." };
  if (isListType(type) && (kind === "boolean" || kind === "json" || kind === "richtext" || kind === "multiline")) {
    return { editable: false, reason: "This type is not edited in this app. Change it in Shopify." };
  }
  return { editable: true };
}

/** Metafield types whose value Shopify lets you translate and that this app can show as text. */
export function translatableMetafield(type: string): boolean {
  if (type === "list.single_line_text_field") return true;
  if (isListType(type)) return false;
  const kind = inputKindOf(type);
  return kind === "text" || kind === "multiline" || kind === "richtext" || kind === "url";
}

export const isRefKind = (kind: InputKind): boolean => kind.startsWith("ref-");

/** The rating scale from a definition's rules, when it has one. */
export function ratingScale(validations: Validation[]): { min: string; max: string } | null {
  const min = validations.find((v) => v.name === "scale_min")?.value;
  const max = validations.find((v) => v.name === "scale_max")?.value;
  return min && max ? { min, max } : null;
}

function blankDraft(kind: InputKind, validations: Validation[]): Draft {
  const d = emptyDraft(kind);
  if (kind === "rating") {
    const scale = ratingScale(validations);
    if (scale) return { ...d, ratingMin: scale.min, ratingMax: scale.max };
  }
  return d;
}

export const newDraft = (type: string, validations: Validation[] = []): Draft => {
  const d = blankDraft(inputKindOf(type), validations);
  return inputKindOf(type) === "boolean" ? { ...d, text: "" } : d;
};

/** The boxes for a stored value. A missing value gives one empty box (single) or none (list). */
export function draftsFromStored(type: string, stored: Value, validations: Validation[] = [], labels: Record<string, string> = {}): Draft[] {
  const kind = inputKindOf(type);
  const list = isListType(type);
  if (isRefKind(kind)) {
    const ids = stored === null ? [] : (parseValue(type, stored) ?? []).map(String);
    return [{ ...blankDraft(kind, validations), refs: ids.map((id): PickedRef => ({ id, label: labels[id] ?? id })) }];
  }
  if (stored === null) return list ? [] : [newDraft(type, validations)];
  if (list) {
    const items = parseValue(type, stored) ?? [];
    return items.map((el) => draftFromValue(baseType(type), elementRaw(el), labels));
  }
  if (kind === "boolean") return [{ ...blankDraft(kind, validations), text: stored }];
  const d = draftFromValue(type, stored, labels);
  return [{ ...blankDraft(kind, validations), ...d, ...(kind === "rating" ? ratingFrom(validations, d) : {}) }];
}

function ratingFrom(validations: Validation[], d: Draft): Partial<Draft> {
  const scale = ratingScale(validations);
  return scale ? { ratingMin: scale.min, ratingMax: scale.max } : { ratingMin: d.ratingMin, ratingMax: d.ratingMax };
}

function elementRaw(el: Element): string {
  return typeof el === "string" ? el : elementToString(el);
}

function draftIsEmpty(kind: InputKind, d: Draft): boolean {
  if (isRefKind(kind)) return d.refs.length === 0;
  return d.text.trim() === "";
}

export type BuiltValue = {
  /** What to store. null = no value (the metafield is deleted). */
  value: Value;
  /** The first problem, shown under the row. null = valid. */
  error: string | null;
  /** One entry per draft: the problem with that item, or null. */
  itemErrors: (string | null)[];
};

/** The boxes -> the stored value, checked against the type and the definition's rules. */
export function storedFromDrafts(type: string, drafts: Draft[], validations: Validation[] = []): BuiltValue {
  const kind = inputKindOf(type);
  const list = isListType(type);
  const itemErrors: (string | null)[] = drafts.map(() => null);
  const none: BuiltValue = { value: null, error: null, itemErrors };

  if (isRefKind(kind)) {
    const refs = drafts[0]?.refs ?? [];
    if (refs.length === 0) return none;
    if (!list && refs.length > 1) return { value: null, error: "Pick only one item.", itemErrors };
    const value = encodeValue(type, refs.map((r) => r.id));
    return { value, error: checkRules(type, validations, value), itemErrors };
  }

  const elements: Element[] = [];
  let firstError = null as string | null;
  drafts.forEach((d, i) => {
    if (draftIsEmpty(kind, d)) return;
    const built = buildElements(type, kind === "boolean" ? { ...d, bool: d.text === "false" ? "false" : "true" } : d);
    if (built.error) {
      itemErrors[i] = built.error;
      firstError ??= built.error;
      return;
    }
    elements.push(...built.elements);
  });

  if (firstError) return { value: null, error: firstError, itemErrors };
  if (elements.length === 0) return none;
  if (!list && elements.length > 1) return { value: null, error: "Enter only one value.", itemErrors };
  const value = encodeValue(type, elements);
  return { value, error: checkRules(type, validations, value), itemErrors };
}

/** True when this row's current value can be edited without losing anything (rich text with unusual formatting cannot). */
export function valueEditable(type: string, stored: Value): boolean {
  if (!supportOf(type).editable) return false;
  return richTextEditable(type, stored);
}

/** Shopify's `choices` rule on a text metafield, as a list. */
export { choicesOf } from "./mfRules";
