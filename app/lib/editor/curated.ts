// Which metafields appear on which screen. The store's metafield definitions are matched by NAME (and key) with a few
// keywords per group, so each screen shows only what belongs to it. Anything that does not match stays reachable through
// the "Add another metafield" chooser of the step, and metafields that already hold a value on the product are shown too.
// Pure.

import { baseType, isListType } from "./mfTypes";
import type { OwnerKind } from "./mfTypes";
import type { StepId } from "./productSteps";

export type DefLike = { namespace: string; key: string; name: string; type: string; ownerKind: OwnerKind };

export type GroupId = "sizes" | "swatches" | "options" | "related" | "text" | "leadTimes" | "images" | "documents";

export type Group = {
  id: GroupId;
  step: StepId;
  /** The sub-tab the group is shown on, when the step has some. */
  sub?: string;
  title: string;
  hint: string;
  owner: OwnerKind;
  /** A definition matches when its name or key contains ALL the words of ANY one of these. */
  any: string[][];
  /** A definition whose name or key matches one of these is never in the group. */
  not?: string[][];
  /** Which metafield types may be in the group. */
  types: (type: string) => boolean;
  /** Only for stock products, or only for made to order. */
  only?: "stock" | "made_to_order";
};

const isFile = (t: string) => baseType(t) === "file_reference";
const isText = (t: string) => ["single_line_text_field", "multi_line_text_field", "rich_text_field", "url"].includes(baseType(t));
const isRefLike = (t: string) => /_reference$/.test(baseType(t)) && !isFile(t);
const anything = () => true;

/** "Build and Delivery time" is deliberately left out of the lead-time screen. */
const EXCLUDED_NAME = "build and delivery time";

export const GROUPS: Group[] = [
  {
    id: "sizes", step: "variantOptions", sub: "sizes", owner: "PRODUCTVARIANT", title: "Sizes & dimensions", hint: "The measurements of each variant.",
    any: [["top", "thickness"], ["mattress", "length"], ["mattress", "width"], ["headboard", "height"], ["person", "space"], ["variant", "width"], ["variant", "length"], ["variant", "height"], ["variant", "depth"], ["thickness"], ["width"], ["length"], ["height"], ["depth"], ["dimension"]],
    not: [["hide"], ["swatch"]],
    types: (t) => !isFile(t),
  },
  { id: "swatches", step: "variantOptions", sub: "swatches", owner: "PRODUCTVARIANT", title: "Swatches & visibility", hint: "How a variant's swatch looks, and where it is hidden.", any: [["swatch"], ["hide", "market"], ["hidden", "market"]], types: anything },
  {
    id: "options", step: "productOptions", sub: "options", owner: "PRODUCT", title: "Options & customisation", hint: "Choices a customer can add to the product.",
    any: [["required", "option"], ["bundle"], ["infinity", "option"], ["customi"], ["addon"]], not: [["recommend"], ["related"]], types: (t) => isRefLike(t) || isText(t) || baseType(t) === "json",
  },
  {
    id: "related", step: "productOptions", sub: "related", owner: "PRODUCT", title: "Related & recommended", hint: "Products shown next to this one.",
    any: [["related"], ["recommend"], ["infinity", "recommend"], ["cross", "sell"], ["upsell"], ["complementary"], ["goes", "with"]], types: (t) => isRefLike(t) || isText(t) || baseType(t) === "json",
  },
  {
    id: "text", step: "content", owner: "PRODUCT", title: "Texts for the product page", hint: "Each text is translated beside the main text.",
    any: [["tag", "line"], ["tagline"], ["wood"], ["material"], ["dimension"], ["description"], ["feature"], ["care"], ["story"], ["finish"], ["note"], ["heading"], ["subtitle"]], not: [["image"], ["video"], ["delivery"], ["production"], ["lead"], ["pdf"], ["spec"], ["recommend"], ["related"]], types: isText,
  },
  {
    id: "leadTimes", step: "leadTimes", owner: "PRODUCT", title: "Delivery & production", hint: "When the product is delivered or made.",
    any: [["stock", "delivery"], ["delivery"], ["production"], ["lead", "time"], ["dispatch"], ["made", "to", "order"], ["shipping"]], not: [[EXCLUDED_NAME], ["recommend"], ["related"]], types: anything,
  },
  { id: "images", step: "files", owner: "PRODUCT", title: "Images & video", hint: "Pictures and videos for the product page.", any: [["image"], ["video"], ["photo"], ["picture"], ["gallery"]], types: isFile },
  { id: "documents", step: "files", owner: "PRODUCT", title: "Documents", hint: "Specification sheets and other documents.", any: [["pdf"], ["spec"], ["document"], ["manual"], ["instruction"], ["brochure"], ["file"]], not: [["image"], ["video"]], types: isFile },
];

/** Lower case, accents and punctuation removed, so "Top Thickness" matches ["top","thickness"] and "top_thickness" too. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every word of a set must START a word of the name ("customi" finds "Customisation", "ship" does not find "relationship"). */
const hit = (haystack: string, sets: string[][]) => {
  const words = haystack.split(" ");
  return sets.some((set) => set.every((w) => words.some((h) => h.startsWith(fold(w)))));
};

export function matches(group: Group, d: DefLike): boolean {
  if (d.ownerKind !== group.owner) return false;
  if (!group.types(d.type)) return false;
  const text = fold(`${d.name} ${d.key}`);
  if (fold(d.name) === EXCLUDED_NAME || text.includes(EXCLUDED_NAME)) return false;
  if (group.not && hit(text, group.not)) return false;
  return hit(text, group.any);
}

export const groupsOf = (step: StepId, sub?: string | null): Group[] => GROUPS.filter((g) => g.step === step && (!sub || g.sub === sub));

export type Placed<D> = { group: Group; defs: D[] };

/**
 * The definitions of one step (or one of its sub-tabs), by group. A definition is placed in the FIRST group it matches
 * across the whole app, so it never shows on two screens. `stockKind` hides groups that only apply to the other kind.
 */
export function placeDefinitions<D extends DefLike>(defs: D[], step: StepId, sub?: string | null, stockKind?: "stock" | "made_to_order"): Placed<D>[] {
  const owner = new Map<string, GroupId>();
  for (const d of defs) {
    const g = GROUPS.find((x) => matches(x, d));
    if (g) owner.set(`${d.ownerKind}|${d.namespace}.${d.key}`, g.id);
  }
  return groupsOf(step, sub)
    .filter((g) => !g.only || !stockKind || g.only === stockKind)
    .map((group) => ({ group, defs: defs.filter((d) => owner.get(`${d.ownerKind}|${d.namespace}.${d.key}`) === group.id) }))
    .filter((p) => p.defs.length > 0);
}

/** Every definition the curated groups place somewhere. */
export function placedKeys<D extends DefLike>(defs: D[]): Set<string> {
  return new Set(defs.filter((d) => GROUPS.some((g) => matches(g, d))).map((d) => `${d.ownerKind}|${d.namespace}.${d.key}`));
}

/**
 * The one step a metafield that no group claims belongs to, by its type: texts on Content, files on Images & files,
 * references and everything else on Product options (variant metafields on Variant details).
 */
export function leftoverStepOf(d: DefLike): StepId {
  if (d.ownerKind === "PRODUCTVARIANT") return "variantOptions";
  if (isFile(d.type)) return "files";
  if (isText(d.type) || (isListType(d.type) && baseType(d.type) === "single_line_text_field")) return "content";
  return "productOptions";
}

/** The step a metafield is shown on: its group's step, else the step its type suggests. */
export function stepOfMetafield(d: DefLike): StepId {
  const group = GROUPS.find((g) => matches(g, d));
  return group ? group.step : leftoverStepOf(d);
}

/** The sub-tab a metafield is shown on within its step (none for steps without sub-tabs). */
export function subOfMetafield(d: DefLike): string | null {
  const group = GROUPS.find((g) => matches(g, d));
  if (group) return group.sub ?? null;
  const step = leftoverStepOf(d);
  return step === "variantOptions" ? "sizes" : step === "productOptions" ? "options" : null;
}

const keyOf = (d: DefLike) => `${d.ownerKind}|${d.namespace}.${d.key}`;

/**
 * Metafields no group claims that belong to this step by type: offered in the "Add another metafield" chooser, and shown
 * right away when the product already holds a value for them (so nothing that is filled in gets overlooked).
 */
export function leftovers<D extends DefLike>(defs: D[], step: StepId): D[] {
  return defs.filter((d) => !GROUPS.some((g) => matches(g, d)) && leftoverStepOf(d) === step && !fold(d.name).includes(EXCLUDED_NAME));
}

/** Leftovers split into those that already have a value (shown) and those that do not (offered in the chooser). */
export function splitLeftovers<D extends DefLike>(defs: D[], step: StepId, hasValue: (d: D) => boolean): { valued: D[]; empty: D[] } {
  const all = leftovers(defs, step);
  return { valued: all.filter(hasValue), empty: all.filter((d) => !hasValue(d)) };
}

/** Definitions for the "Add another metafield" chooser of a step: its leftovers, and group members too when they are not shown. */
export function chooserDefinitions<D extends DefLike>(defs: D[], step: StepId, shown: Set<string>): D[] {
  return leftovers(defs, step).filter((d) => !shown.has(keyOf(d)));
}
