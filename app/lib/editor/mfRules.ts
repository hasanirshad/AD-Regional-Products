// Rules from the metafield definition (the "validations" in Shopify): choices, minimum and maximum, pattern, precision,
// allowed domains, list length. Checked before anything is written, so a bad value is blocked in the review
// instead of failing after Shopify rejects a whole chunk. Pure.
//
// Covered: single line and multi-line text, whole and decimal numbers, URL, date, date and time, and lists of those
// (each item is checked, plus the list length). Rules for dimension, weight, volume, money, rating, references and
// JSON are left to Shopify, which still checks them when the value is written.
import { baseType, inputKindOf, isListType, parseValue } from "./mfTypes";

export interface Validation {
  name: string;
  value: string | null;
}

function find(validations: Validation[], name: string): string | null {
  const rule = validations.find((v) => v.name === name);
  return rule && rule.value !== null && rule.value !== "" ? rule.value : null;
}

function jsonArray(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

/** The allowed choices of a text metafield, or null when it has none. */
export function choicesOf(validations: Validation[]): string[] | null {
  const choices = jsonArray(find(validations, "choices"));
  return choices && choices.length > 0 ? choices : null;
}

const length = (s: string) => Array.from(s).length;
const asNumber = (s: string | null): number | null => {
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

function checkItem(type: string, validations: Validation[], item: string): string | null {
  const kind = inputKindOf(type);
  const min = find(validations, "min");
  const max = find(validations, "max");

  if (kind === "text" || kind === "multiline") {
    const choices = kind === "text" ? choicesOf(validations) : null;
    if (choices && !choices.includes(item)) return `"${item}" is not one of the allowed choices (${choices.join(", ")}).`;
    const minLen = asNumber(min);
    const maxLen = asNumber(max);
    if (minLen !== null && length(item) < minLen) return `Must be at least ${minLen} characters.`;
    if (maxLen !== null && length(item) > maxLen) return `Must be at most ${maxLen} characters.`;
    const pattern = kind === "text" ? find(validations, "regex") : null;
    if (pattern) {
      try {
        if (!new RegExp(pattern).test(item)) return `"${item}" does not match the required pattern.`;
      } catch {
        // A pattern this app cannot read: Shopify decides.
      }
    }
    return null;
  }

  if (kind === "integer" || kind === "decimal") {
    const n = Number(item);
    const lo = asNumber(min);
    const hi = asNumber(max);
    if (lo !== null && n < lo) return `Must be at least ${lo}.`;
    if (hi !== null && n > hi) return `Must be at most ${hi}.`;
    const precision = asNumber(find(validations, "max_precision"));
    if (kind === "decimal" && precision !== null) {
      const decimals = item.includes(".") ? (item.split(".")[1] ?? "").length : 0;
      if (decimals > precision) return `Use at most ${precision} decimal places.`;
    }
    return null;
  }

  if (kind === "url") {
    const domains = jsonArray(find(validations, "allowed_domains"));
    if (domains && domains.length > 0) {
      const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(item);
      const host = match?.[1] ? match[1].toLowerCase() : "";
      const ok = domains.some((d) => {
        const domain = d.toLowerCase();
        return host === domain || host.endsWith(`.${domain}`);
      });
      if (!ok) return `The address must be on one of these domains: ${domains.join(", ")}.`;
    }
    return null;
  }

  if (kind === "date" || kind === "datetime") {
    const time = Date.parse(item);
    const lo = min ? Date.parse(min) : NaN;
    const hi = max ? Date.parse(max) : NaN;
    if (!Number.isNaN(lo) && time < lo) return `Must be on or after ${min}.`;
    if (!Number.isNaN(hi) && time > hi) return `Must be on or before ${max}.`;
    return null;
  }

  return null;
}

/** The first problem with a stored value, or null when it follows the definition's rules (or the rules are not covered). */
export function checkRules(type: string, validations: Validation[], stored: string | null): string | null {
  if (stored === null || validations.length === 0) return null;
  if (isListType(type)) {
    const items = parseValue(type, stored);
    if (items === null) return null;
    const listMin = asNumber(find(validations, "list.min"));
    const listMax = asNumber(find(validations, "list.max"));
    if (listMin !== null && items.length < listMin) return `The list needs at least ${listMin} items.`;
    if (listMax !== null && items.length > listMax) return `The list can have at most ${listMax} items.`;
    const itemType = baseType(type);
    for (const item of items) {
      const problem = checkItem(itemType, validations, String(item));
      if (problem) return problem;
    }
    return null;
  }
  return checkItem(type, validations, stored);
}
