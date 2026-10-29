// The settings of the health checks (Product health, Data quality, Storefront readiness, Options and swatches,
// Content snapshot): groups, profiles, thresholds, theme fields, helper-product rules and the linked-record settings.
//
// Pure: no Shopify global, no Preact. Imported by settings.ts (defaults, reading, value rules), by the rules engine and
// by the Settings page. It only imports TYPES from settings.ts, so there is no cycle at run time.

import type { FieldRef, Problem } from "./settings";

// ---------------------------------------------------------------- vocabulary

export const GROUPS = ["basics", "seo", "images", "variants", "theme", "markets", "linked"] as const;
export type GroupId = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<GroupId, string> = {
  basics: "Basics",
  seo: "SEO",
  images: "Images",
  variants: "Variants and pricing",
  theme: "Theme fields",
  markets: "Markets",
  linked: "Linked records",
};
export const GROUP_ABOUT: Record<GroupId, string> = {
  basics: "Description, product type, duplicate titles.",
  seo: "SEO title and description: empty, too long, too short.",
  images: "Number of images and alt text.",
  variants: "Price, compare-at, SKU, weight, cost, variant titles and images.",
  theme: "The metafields the storefront theme reads (list on the Theme fields tab).",
  markets: "Published in at least one market, and in every market.",
  linked: "Swatch, delivery-time and design records the product points to (needs the metaobject permissions).",
};

export const PROFILES = ["real", "option", "bundle"] as const;
export type ProfileId = (typeof PROFILES)[number];
export const PROFILE_LABEL: Record<ProfileId, string> = { real: "Real product", option: "Option product", bundle: "Bundle" };

export const SEVERITIES = ["blocks", "hurts", "nice"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABEL: Record<Severity, string> = { blocks: "Blocks storefront", hurts: "Hurts SEO or sales", nice: "Nice to have" };

// ---------------------------------------------------------------- the single checks (Advanced fold)

export type RuleInfo = { id: string; group: GroupId; label: string; severity: Severity; /** Only these profiles run it. Missing = every profile the group is on for. */ only?: ProfileId[] };

export const RULE_CATALOGUE: RuleInfo[] = [
  { id: "basics.body", group: "basics", label: "Description is not empty", severity: "hurts", only: ["real", "bundle"] },
  { id: "basics.type", group: "basics", label: "Product type is set", severity: "hurts" },
  { id: "basics.typeWood", group: "basics", label: "Product type is not a wood or material name", severity: "hurts" },
  { id: "basics.typeList", group: "basics", label: "Product type is one of the expected categories", severity: "nice" },
  { id: "basics.duplicateTitle", group: "basics", label: "Title is not used by another product", severity: "hurts", only: ["real", "bundle"] },
  { id: "seo.title", group: "seo", label: "SEO title is set", severity: "hurts" },
  { id: "seo.titleLength", group: "seo", label: "SEO title is not too long", severity: "nice" },
  { id: "seo.desc", group: "seo", label: "SEO description is set", severity: "hurts" },
  { id: "seo.descLength", group: "seo", label: "SEO description has a good length", severity: "nice" },
  { id: "images.count", group: "images", label: "Enough images", severity: "hurts" },
  { id: "images.alt", group: "images", label: "Images have alt text", severity: "hurts" },
  { id: "variants.price", group: "variants", label: "Every variant is priced above zero", severity: "blocks" },
  { id: "variants.compareLower", group: "variants", label: "Compare-at price is not below the price", severity: "hurts" },
  { id: "variants.compareEqual", group: "variants", label: "Compare-at price differs from the price", severity: "nice" },
  { id: "variants.sku", group: "variants", label: "SKU is filled", severity: "nice" },
  { id: "variants.weight", group: "variants", label: "Weight is set", severity: "nice" },
  { id: "variants.cost", group: "variants", label: "Cost per item is set", severity: "nice" },
  { id: "variants.spaces", group: "variants", label: "Variant titles have no extra spaces", severity: "hurts" },
  { id: "variants.image", group: "variants", label: "Every variant has an image", severity: "nice" },
  { id: "variants.dupValues", group: "variants", label: "No option value is listed twice", severity: "hurts" },
  { id: "theme.lengthSeater", group: "theme", label: "Length and seater are filled", severity: "hurts" },
  { id: "theme.lead", group: "theme", label: "Lead time is set", severity: "hurts" },
  { id: "markets.any", group: "markets", label: "In at least one market", severity: "blocks" },
  { id: "markets.spread", group: "markets", label: "Published in every market", severity: "nice" },
  { id: "linked.swatches", group: "linked", label: "Swatch records are healthy", severity: "hurts" },
  { id: "linked.delivery", group: "linked", label: "A delivery-time record is active", severity: "hurts" },
  { id: "linked.design", group: "linked", label: "Design records have a link", severity: "nice" },
];

/** Rule ids the first version of the settings switched off through its single checks. */
export const LEGACY_CHECK_RULES: Record<string, string[]> = {
  image: ["images.count"],
  alt: ["images.alt"],
  spaces: ["variants.spaces"],
  seo: ["seo.title", "seo.titleLength", "seo.desc", "seo.descLength"],
  price: ["variants.price"],
  market: ["markets.any"],
};

// ---------------------------------------------------------------- settings types

export type GroupsSetting = {
  groups: Record<GroupId, boolean>;
  /** Which groups apply to which kind of product. A group that is off for everyone stays off here too. */
  profiles: Record<ProfileId, Record<GroupId, boolean>>;
  /** Single checks switched off (ids from RULE_CATALOGUE). */
  disabledRules: string[];
};

export type Thresholds = {
  seoTitleMax: number;
  seoDescMin: number;
  seoDescMax: number;
  minImages: number;
  /** Percent of images that need alt text. */
  altTarget: number;
  weights: Record<Severity, number>;
  /** Key of the market that counts as the main one (a market key from the Markets tab). */
  primaryMarket: string;
};

export const THEME_RULES = ["filled", "clean", "boolean", "handles", "targets", "sameAs"] as const;
export type ThemeRule = (typeof THEME_RULES)[number];
export const THEME_RULE_LABEL: Record<ThemeRule, string> = {
  filled: "Must not be empty",
  clean: "Not empty, no extra spaces",
  boolean: "Only true, false, 0 or 1",
  handles: "Handles must exist and be published (not this product)",
  targets: "Handles must exist",
  sameAs: "Same text as another metafield",
};

export type ThemeField = {
  id: string;
  label: string;
  namespace: string;
  key: string;
  owner: "product" | "variant";
  rule: ThemeRule;
  /** Only for rule "sameAs": the metafield to compare with (a product metafield). */
  other?: { namespace: string; key: string };
  /** Which kinds of product it is required for. Empty = not required for any (switched off in effect). */
  profiles: ProfileId[];
  severity: Severity;
  on: boolean;
};

export type HelpersSetting = {
  /** Product types (or categories) that mean "Option product". Case does not matter. */
  types: string[];
  tags: string[];
  /** Words in the title; * matches anything. */
  titlePatterns: string[];
  bundleTypes: string[];
  bundleTags: string[];
  /** Names a Type should be one of. Empty = this check is not applicable. */
  expectedCategories: string[];
  /** Wood or material names that are not a category. */
  woodNames: string[];
};

export type RecordsSetting = {
  /** Metaobject type (handle) of the swatch records, the delivery-time records and the design records. Empty = not used. */
  swatchType: string;
  deliveryType: string;
  designType: string;
  /** The variant metafield that points to a swatch record. */
  swatchField: FieldRef;
  /** The variant metafield that lists the markets a variant is hidden in. */
  hideField: FieldRef;
};

// ---------------------------------------------------------------- defaults

const allOn = (): Record<GroupId, boolean> => ({ basics: true, seo: true, images: true, variants: true, theme: true, markets: true, linked: true });

export function defaultGroups(): GroupsSetting {
  return {
    groups: allOn(),
    profiles: {
      real: allOn(),
      option: { basics: true, seo: false, images: false, variants: true, theme: false, markets: true, linked: false },
      bundle: { ...allOn(), linked: false },
    },
    disabledRules: [],
  };
}

export const defaultThresholds = (): Thresholds => ({ seoTitleMax: 60, seoDescMin: 50, seoDescMax: 160, minImages: 1, altTarget: 100, weights: { blocks: 3, hurts: 2, nice: 1 }, primaryMarket: "UK" });

const tf = (label: string, key: string, rule: ThemeRule, profiles: ProfileId[], severity: Severity, extra: Partial<ThemeField> = {}): ThemeField => ({
  id: `tf:custom.${key}${extra.other ? `~${extra.other.key}` : ""}`,
  label,
  namespace: "custom",
  key,
  owner: "product",
  rule,
  profiles,
  severity,
  on: true,
  ...extra,
});

/** The metafields the Hardman theme reads (from the store export). Editable on the Theme fields tab. */
export function defaultThemeFields(): ThemeField[] {
  return [
    tf("Tag line", "tag_line", "filled", ["real", "bundle"], "nice"),
    tf("Wood type", "product_wood_type", "clean", ["real"], "hurts"),
    tf("Material title", "material-main-title", "filled", ["real"], "hurts"),
    tf("Wood type matches material title", "product_wood_type", "sameAs", ["real"], "hurts", { other: { namespace: "custom", key: "material-main-title" } }),
    tf("Related products", "hd_related_products", "handles", ["real"], "nice"),
    tf("Recommended products", "hd_recommended_products", "handles", ["real"], "nice"),
    tf("Stock and delivery", "stock_delivery", "filled", ["real"], "hurts"),
    tf("Design and customisation", "design_customisation", "filled", ["real"], "nice"),
    tf("Required options", "required_options", "targets", ["real", "bundle"], "hurts"),
    { id: "tf:seo.hidden", label: "SEO hidden flag", namespace: "seo", key: "hidden", owner: "product", rule: "boolean", profiles: ["real", "option", "bundle"], severity: "nice", on: true },
  ];
}

export const WOOD_NAMES = ["oak", "ash", "walnut", "american walnut", "european walnut", "maple", "cherry", "beech", "pine", "elm", "sycamore", "birch", "mahogany", "teak", "all_materials", "all materials"];

export const defaultHelpers = (): HelpersSetting => ({
  types: ["finish", "finishes", "edge", "edges", "leg", "legs", "service", "services", "option", "options"],
  tags: ["option", "option-product", "helper"],
  titlePatterns: [],
  bundleTypes: ["bundle", "bundles", "set", "sets"],
  bundleTags: ["bundle"],
  expectedCategories: [],
  woodNames: [...WOOD_NAMES],
});

export const defaultRecords = (): RecordsSetting => ({
  swatchType: "swatches",
  deliveryType: "build_and_delivery_time",
  designType: "design_customisation",
  swatchField: { label: "Swatch", namespace: "custom", key: "swatches_test", owner: "variant" },
  hideField: { label: "Hide from markets", namespace: "custom", key: "hide_from_markets", owner: "variant" },
});

// ---------------------------------------------------------------- value rules

const NAMESPACE_RE = /^[A-Za-z0-9_-]{3,255}$/;
const KEY_RE = /^[A-Za-z0-9_-]{2,64}$/;
const TYPE_RE = /^[A-Za-z0-9_$-]{1,255}$/;
export const MAX_THEME_FIELDS = 40;
export const MAX_LIST = 40;

const isGroup = (v: string): v is GroupId => (GROUPS as readonly string[]).includes(v);
const isProfile = (v: string): v is ProfileId => (PROFILES as readonly string[]).includes(v);

function listProblems(path: string, list: string[], out: Problem[], what: string) {
  if (list.length > MAX_LIST) out.push({ path, message: `Up to ${MAX_LIST} ${what}.` });
  const seen = new Set<string>();
  list.forEach((v, i) => {
    if (!v.trim() || v.length > 60) out.push({ path: `${path}.${i}`, message: "Each entry is 1 to 60 characters." });
    const k = v.trim().toLowerCase();
    if (seen.has(k)) out.push({ path: `${path}.${i}`, message: `"${v}" is listed twice.` });
    seen.add(k);
  });
}

/** Value rules for the five health sections. `marketKeys` are the keys of the Markets tab. */
export function healthProblems(s: { groups: GroupsSetting; thresholds: Thresholds; themeFields: ThemeField[]; helpers: HelpersSetting; records: RecordsSetting }, marketKeys: Set<string>): Problem[] {
  const out: Problem[] = [];

  const g = s.groups;
  if (g.disabledRules.length > 100) out.push({ path: "groups.disabledRules", message: "Too many single checks switched off." });

  const t = s.thresholds;
  const whole = (path: string, v: number, lo: number, hi: number, label: string) => {
    if (!Number.isInteger(v) || v < lo || v > hi) out.push({ path, message: `${label}: a whole number from ${lo} to ${hi}.` });
  };
  whole("thresholds.seoTitleMax", t.seoTitleMax, 10, 200, "SEO title maximum");
  whole("thresholds.seoDescMin", t.seoDescMin, 0, 300, "SEO description minimum");
  whole("thresholds.seoDescMax", t.seoDescMax, 20, 500, "SEO description maximum");
  if (Number.isInteger(t.seoDescMin) && Number.isInteger(t.seoDescMax) && t.seoDescMin > t.seoDescMax) out.push({ path: "thresholds.seoDescMin", message: "The minimum cannot be above the maximum." });
  whole("thresholds.minImages", t.minImages, 0, 50, "Minimum images");
  whole("thresholds.altTarget", t.altTarget, 0, 100, "Alt text target (percent)");
  for (const sev of SEVERITIES) whole(`thresholds.weights.${sev}`, t.weights[sev], 0, 10, `Score weight "${SEVERITY_LABEL[sev]}"`);
  if (SEVERITIES.every((sev) => t.weights[sev] === 0)) out.push({ path: "thresholds.weights.blocks", message: "At least one score weight must be above zero." });
  if (t.primaryMarket !== "" && !marketKeys.has(t.primaryMarket)) out.push({ path: "thresholds.primaryMarket", message: "Choose one of the markets on the Markets tab." });

  if (s.themeFields.length > MAX_THEME_FIELDS) out.push({ path: "themeFields", message: `Up to ${MAX_THEME_FIELDS} theme fields.` });
  const ids = new Set<string>();
  s.themeFields.forEach((f, i) => {
    const p = `themeFields.${i}`;
    if (ids.has(f.id)) out.push({ path: p, message: "This theme field is listed twice." });
    ids.add(f.id);
    if (!f.label.trim() || f.label.length > 60) out.push({ path: `${p}.label`, message: "Give it a name of 1 to 60 characters." });
    if (!NAMESPACE_RE.test(f.namespace)) out.push({ path: `${p}.key`, message: `"${f.namespace}" is not a metafield namespace. Use 3 to 255 letters, digits, - or _.` });
    else if (!KEY_RE.test(f.key)) out.push({ path: `${p}.key`, message: `"${f.key}" is not a metafield key. Use 2 to 64 letters, digits, - or _.` });
    if (f.owner !== "product" && f.owner !== "variant") out.push({ path: `${p}.owner`, message: "Choose product or variant." });
    if (!(THEME_RULES as readonly string[]).includes(f.rule)) out.push({ path: `${p}.rule`, message: "Unknown rule." });
    if (!(SEVERITIES as readonly string[]).includes(f.severity)) out.push({ path: `${p}.severity`, message: "Unknown severity." });
    if (f.profiles.some((x) => !isProfile(x))) out.push({ path: `${p}.profiles`, message: "Unknown kind of product." });
    if (f.rule === "sameAs") {
      if (!f.other || !NAMESPACE_RE.test(f.other.namespace) || !KEY_RE.test(f.other.key)) out.push({ path: `${p}.other`, message: "Choose the metafield to compare with." });
      if (f.owner !== "product") out.push({ path: `${p}.owner`, message: "Comparing two metafields works for product metafields only." });
    }
    if ((f.rule === "handles" || f.rule === "targets") && f.owner !== "product") out.push({ path: `${p}.owner`, message: "Handle lists work for product metafields only." });
  });

  const h = s.helpers;
  listProblems("helpers.types", h.types, out, "types");
  listProblems("helpers.tags", h.tags, out, "tags");
  listProblems("helpers.titlePatterns", h.titlePatterns, out, "title patterns");
  listProblems("helpers.bundleTypes", h.bundleTypes, out, "types");
  listProblems("helpers.bundleTags", h.bundleTags, out, "tags");
  listProblems("helpers.expectedCategories", h.expectedCategories, out, "categories");
  listProblems("helpers.woodNames", h.woodNames, out, "names");

  const r = s.records;
  for (const [path, v] of [["records.swatchType", r.swatchType], ["records.deliveryType", r.deliveryType], ["records.designType", r.designType]] as const) {
    if (v !== "" && !TYPE_RE.test(v)) out.push({ path, message: "A metaobject type has letters, digits, - or _ (it is the handle shown in the definition's address). Leave it empty to skip those checks." });
  }
  for (const [path, f] of [["records.swatchField", r.swatchField], ["records.hideField", r.hideField]] as const) {
    if (!NAMESPACE_RE.test(f.namespace) || !KEY_RE.test(f.key)) out.push({ path, message: "Choose a variant metafield (namespace 3+ characters, key 2+ characters)." });
  }
  return out;
}

export { isGroup };
