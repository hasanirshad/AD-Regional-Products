// The settings of the Product Insights blocks, and the one place that reads and checks them.
//
// Where they live: one JSON value in an app-owned metafield (`$app` / `block_settings`) on the app installation, so
// there is no server and no database. The Settings page of the app writes it (password + review). Every block reads it
// when it loads. If it is missing, not JSON, or a part of it is not valid, that part falls back to the defaults below
// (which are the values in constants.ts), so a bad save can never break a block.
//
// This file is pure: no Shopify global, no Preact, no React. The blocks and the app both import it.

import {
  defaultGroups,
  defaultHelpers,
  defaultRecords,
  defaultThemeFields,
  defaultThresholds,
  healthProblems,
  LEGACY_CHECK_RULES,
  PROFILES,
  GROUPS,
  SEVERITIES,
  THEME_RULES,
  type GroupId,
  type GroupsSetting,
  type HelpersSetting,
  type ProfileId,
  type RecordsSetting,
  type Severity,
  type ThemeField,
  type ThemeRule,
  type Thresholds,
} from "./healthSettings";
import { EVENTS_LIMIT, LANGUAGES, MARKETS, type MarketDef, PREVIEW_MARKET_KEY, PREVIEW_THEME_ID, REQUIRED_FIELDS, SALE_BADGE, SALE_COLLECTION_HANDLE, TRANSLATED_METAFIELD_NAMESPACES } from "./constants";

export const SETTINGS_NAMESPACE = "$app";
export const SETTINGS_KEY = "block_settings";
export const SETTINGS_VERSION = 2;
/** The metafield value limit is about 2 MB; settings stay far below it. */
export const MAX_SETTINGS_CHARS = 100_000;

// ---------------------------------------------------------------- types

export type FieldRef = { label: string; namespace: string; key: string; owner: "product" | "variant" };
export type Language = { code: string; label: string };

export type MarketSetting = {
  /** Short label shown in the blocks, for example "FR". */
  key: string;
  label: string;
  /** ISO country code used to ask Shopify for the price in that market. */
  country: string;
  /** Storefront domain without https:// and without a trailing slash. A subfolder is fine: "example.com/fr". */
  domain: string;
  /** The US storefront redirects visitors from elsewhere unless ?stay_us=1 is added. */
  stayUs: boolean;
  /** Only when two markets share a country: the handle of the market to use. */
  marketHandle: string;
  /** Shown in the Market availability, Sale and badge and Quick links blocks. */
  enabled: boolean;
  /** The language the market sells in when it is not the main language ("" = the main language). Used by Storefront readiness. */
  locale: string;
};

export const CORE_FIELDS = ["title", "body_html", "meta_title", "meta_description", "handle"] as const;
export type CoreField = (typeof CORE_FIELDS)[number];
export const CORE_FIELD_LABEL: Record<CoreField, string> = { title: "Title", body_html: "Description", meta_title: "SEO title", meta_description: "SEO description", handle: "Handle (URL)" };

export type TranslationRow =
  | { type: "core"; field: CoreField }
  /** One product metafield. */
  | { type: "metafield"; namespace: string; key: string }
  /** Every product metafield in a namespace (the first 50). */
  | { type: "namespace"; namespace: string }
  | { type: "optionNames" }
  | { type: "optionValues" };

export const CHECK_KINDS = ["image", "alt", "spaces", "lengthSeater", "seo", "lead", "price", "market", "metafield"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export type CheckSetting = {
  id: string;
  kind: CheckKind;
  label: string;
  on: boolean;
  /** Only for kind "metafield": the metafield that must not be empty. */
  field?: FieldRef;
};

export type Adaptation = { locale: string; marketId: string; marketName: string };

export type BlockSettings = {
  version: number;
  /** Languages shown in Translation status and Sale and badge. */
  languages: Language[];
  translation: { rows: TranslationRow[] };
  quality: { checks: CheckSetting[]; fields: { length: FieldRef[]; seater: FieldRef[]; leadTime: FieldRef[] } };
  links: { previewThemeId: string; previewMarket: string };
  markets: MarketSetting[];
  sale: { badgeNamespace: string; badgeKey: string; collectionHandle: string };
  collections: { showTags: boolean; showType: boolean };
  activity: { eventsLimit: number };
  /** A language adapted for one market. Used by the editor: each one adds a translation box. */
  adaptations: Adaptation[];
  /** Health checks (version 2): groups and profiles, thresholds, theme fields, helper-product rules, linked records. */
  groups: GroupsSetting;
  thresholds: Thresholds;
  themeFields: ThemeField[];
  helpers: HelpersSetting;
  records: RecordsSetting;
};

export type SectionId = "languages" | "translation" | "quality" | "links" | "markets" | "sale" | "collections" | "activity" | "adaptations" | "groups" | "thresholds" | "themeFields" | "helpers" | "records";
export const SECTIONS: SectionId[] = ["languages", "translation", "quality", "links", "markets", "sale", "collections", "activity", "adaptations", "groups", "thresholds", "themeFields", "helpers", "records"];

export * from "./healthSettings";

export type Problem = { path: string; message: string };

// ---------------------------------------------------------------- the catalogue of checks

const CHECK_LABEL: Record<CheckKind, string> = {
  image: "At least one image",
  alt: "Image alt text",
  spaces: "Variant titles have no extra spaces",
  lengthSeater: "Length and seater filled",
  seo: "SEO title and description",
  lead: "Lead time set",
  price: "Price above zero",
  market: "Published to at least one market",
  metafield: "Metafield filled",
};

const CHECK_ABOUT: Record<CheckKind, string> = {
  image: "The product has at least one image.",
  alt: "Every image has alt text.",
  spaces: "No variant title or option value starts or ends with a space.",
  lengthSeater: "The length and seater metafields (set in the metafield keys below) are filled on every variant.",
  seo: "Both the SEO title and the SEO description are set.",
  lead: "The lead-time metafields (set in the metafield keys below) are filled.",
  price: "Every variant is priced above zero.",
  market: "The product is in at least one market catalogue.",
  metafield: "A metafield you choose must not be empty.",
};

/** Only the Settings page and the tests use this list; the blocks use `checkLabel`. */
export const CHECK_CATALOGUE: { kind: CheckKind; label: string; about: string; repeatable: boolean }[] = CHECK_KINDS.map((kind) => ({ kind, label: CHECK_LABEL[kind], about: CHECK_ABOUT[kind], repeatable: kind === "metafield" }));

export const checkLabel = (kind: CheckKind): string => CHECK_LABEL[kind] ?? kind;

/** The id of a custom metafield check. */
export const customCheckId = (f: Pick<FieldRef, "namespace" | "key" | "owner">) => `mf:${f.owner}:${f.namespace}.${f.key}`;

// ---------------------------------------------------------------- defaults (today's behaviour)

const ref = (f: { label: string; namespace: string; key: string; owner: "product" | "variant" }): FieldRef => ({ label: f.label, namespace: f.namespace, key: f.key, owner: f.owner });

export function defaultSection<K extends SectionId>(id: K): BlockSettings[K extends "languages" ? "languages" : K] {
  const d = defaultSettings();
  return structuredClone(d[id]) as BlockSettings[K extends "languages" ? "languages" : K];
}

export function defaultSettings(): BlockSettings {
  return {
    version: SETTINGS_VERSION,
    languages: LANGUAGES.map((l) => ({ code: l.code, label: l.label })),
    translation: {
      rows: [
        ...CORE_FIELDS.map((field): TranslationRow => ({ type: "core", field })),
        ...TRANSLATED_METAFIELD_NAMESPACES.map((namespace): TranslationRow => ({ type: "namespace", namespace })),
        { type: "optionNames" },
        { type: "optionValues" },
      ],
    },
    quality: {
      checks: (["image", "alt", "spaces", "lengthSeater", "seo", "lead", "price", "market"] as const).map((kind) => ({ id: kind, kind, label: checkLabel(kind), on: true })),
      fields: { length: REQUIRED_FIELDS.length.map(ref), seater: REQUIRED_FIELDS.seater.map(ref), leadTime: REQUIRED_FIELDS.leadTime.map(ref) },
    },
    links: { previewThemeId: PREVIEW_THEME_ID, previewMarket: PREVIEW_MARKET_KEY },
    markets: MARKETS.map((m) => ({ key: m.key, label: m.label, country: m.country, domain: m.domain, stayUs: Boolean(m.stayUs), marketHandle: m.marketHandle ?? "", enabled: true, locale: m.locale ?? "" })),
    sale: { badgeNamespace: SALE_BADGE.namespace, badgeKey: SALE_BADGE.key, collectionHandle: SALE_COLLECTION_HANDLE },
    collections: { showTags: true, showType: true },
    activity: { eventsLimit: EVENTS_LIMIT },
    adaptations: [],
    groups: defaultGroups(),
    thresholds: defaultThresholds(),
    themeFields: defaultThemeFields(),
    helpers: defaultHelpers(),
    records: defaultRecords(),
  };
}

// ---------------------------------------------------------------- value rules (one place, used by the blocks and the page)

const NAMESPACE_RE = /^[A-Za-z0-9_-]{3,255}$/;
const KEY_RE = /^[A-Za-z0-9_-]{2,64}$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const HANDLE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[a-z0-9][a-z0-9-]*)?$/;
const MARKET_GID_RE = /^gid:\/\/shopify\/Market\/\d+$/;
const MARKET_KEY_RE = /^[A-Za-z0-9_-]{1,12}$/;

export const MAX_EVENTS = 50;
export const MAX_ROWS = 60;
export const MAX_CHECKS = 40;
export const MAX_FIELDS_PER_GROUP = 10;
export const MAX_ADAPTATIONS = 30;

/** The theme id as Shopify's admin URL or a GID shows it: digits only is what the preview link needs. */
export function normalizeThemeId(text: string): string {
  const t = text.trim();
  const gid = /^gid:\/\/shopify\/OnlineStoreTheme\/(\d+)$/.exec(t);
  if (gid) return gid[1]!;
  const url = /\/themes\/(\d+)/.exec(t);
  if (url) return url[1]!;
  return t;
}

/** A typed domain: removes https://, a trailing slash and capitals. Returns the text unchanged when it is not a domain. */
export function normalizeDomain(text: string): string {
  return text.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
}

export const themeIdProblem = (v: string): string | null => (v === "" || /^\d{6,20}$/.test(v) ? null : "A theme id is digits only, for example 143918219507. You can paste the theme's address from the admin.");
export const domainProblem = (v: string): string | null => (v === "" ? "Type the storefront domain, for example hardmandesign.fr." : DOMAIN_RE.test(v) ? null : "Use the domain only, for example hardmandesign.fr or example.com/fr: no https://, no spaces, no ending slash.");

const metafieldProblem = (namespace: string, key: string): string | null => {
  if (!NAMESPACE_RE.test(namespace)) return `"${namespace}" is not a metafield namespace. Use 3 to 255 letters, digits, - or _.`;
  if (!KEY_RE.test(key)) return `"${key}" is not a metafield key. Use 2 to 64 letters, digits, - or _.`;
  return null;
};

function fieldRefProblems(path: string, f: FieldRef, out: Problem[]) {
  if (!f.label.trim() || f.label.length > 60) out.push({ path: `${path}.label`, message: "Give it a name of 1 to 60 characters." });
  const bad = metafieldProblem(f.namespace, f.key);
  if (bad) out.push({ path: `${path}.key`, message: bad });
  if (f.owner !== "product" && f.owner !== "variant") out.push({ path: `${path}.owner`, message: "Choose product or variant." });
}

/** Checks the values of a full settings object. Pure: no store data. The page adds the definition check (see problemsAgainstDefinitions). */
export function problemsOf(s: BlockSettings): Problem[] {
  const out: Problem[] = [];

  if (s.languages.length === 0) out.push({ path: "languages", message: "Choose at least one language." });
  if (s.languages.length > 20) out.push({ path: "languages", message: "Up to 20 languages." });
  const codes = new Set<string>();
  s.languages.forEach((l, i) => {
    if (!LOCALE_RE.test(l.code)) out.push({ path: `languages.${i}.code`, message: `"${l.code}" is not a language code.` });
    if (codes.has(l.code)) out.push({ path: `languages.${i}.code`, message: `${l.code} is listed twice.` });
    codes.add(l.code);
    if (!l.label.trim() || l.label.length > 40) out.push({ path: `languages.${i}.label`, message: "Give the language a name of 1 to 40 characters." });
  });

  const rows = s.translation.rows;
  if (rows.length === 0) out.push({ path: "translation.rows", message: "Show at least one row." });
  if (rows.length > MAX_ROWS) out.push({ path: "translation.rows", message: `Up to ${MAX_ROWS} rows.` });
  const seenRows = new Set<string>();
  rows.forEach((r, i) => {
    const id = rowId(r);
    if (seenRows.has(id)) out.push({ path: `translation.rows.${i}`, message: "This row is listed twice." });
    seenRows.add(id);
    if (r.type === "core" && !(CORE_FIELDS as readonly string[]).includes(r.field)) out.push({ path: `translation.rows.${i}`, message: "Unknown field." });
    if (r.type === "metafield") {
      const bad = metafieldProblem(r.namespace, r.key);
      if (bad) out.push({ path: `translation.rows.${i}`, message: bad });
    }
    if (r.type === "namespace" && !NAMESPACE_RE.test(r.namespace)) out.push({ path: `translation.rows.${i}`, message: `"${r.namespace}" is not a metafield namespace.` });
  });

  const q = s.quality;
  if (q.checks.length > MAX_CHECKS) out.push({ path: "quality.checks", message: `Up to ${MAX_CHECKS} checks.` });
  const ids = new Set<string>();
  q.checks.forEach((c, i) => {
    if (ids.has(c.id)) out.push({ path: `quality.checks.${i}`, message: "This check is listed twice." });
    ids.add(c.id);
    if (!(CHECK_KINDS as readonly string[]).includes(c.kind)) out.push({ path: `quality.checks.${i}`, message: "Unknown check." });
    if (!c.label.trim() || c.label.length > 80) out.push({ path: `quality.checks.${i}.label`, message: "Give the check a name of 1 to 80 characters." });
    if (c.kind === "metafield") {
      if (!c.field) out.push({ path: `quality.checks.${i}.field`, message: "Choose the metafield that must not be empty." });
      else fieldRefProblems(`quality.checks.${i}.field`, c.field, out);
    }
  });
  (["length", "seater", "leadTime"] as const).forEach((g) => {
    if (q.fields[g].length > MAX_FIELDS_PER_GROUP) out.push({ path: `quality.fields.${g}`, message: `Up to ${MAX_FIELDS_PER_GROUP} metafields.` });
    q.fields[g].forEach((f, i) => fieldRefProblems(`quality.fields.${g}.${i}`, f, out));
  });

  const keys = new Set<string>();
  s.markets.forEach((m, i) => {
    if (!MARKET_KEY_RE.test(m.key)) out.push({ path: `markets.${i}.key`, message: "A short code of 1 to 12 letters or digits, for example FR." });
    if (keys.has(m.key)) out.push({ path: `markets.${i}.key`, message: `${m.key} is used twice.` });
    keys.add(m.key);
    if (!m.label.trim() || m.label.length > 40) out.push({ path: `markets.${i}.label`, message: "Give the market a name of 1 to 40 characters." });
    if (!COUNTRY_RE.test(m.country)) out.push({ path: `markets.${i}.country`, message: "A two-letter country code in capitals, for example GB." });
    const d = domainProblem(m.domain);
    if (d) out.push({ path: `markets.${i}.domain`, message: d });
    if (m.marketHandle !== "" && !HANDLE_RE.test(m.marketHandle)) out.push({ path: `markets.${i}.marketHandle`, message: "A market handle has lowercase letters, digits and dashes." });
    if (m.locale !== "" && !LOCALE_RE.test(m.locale)) out.push({ path: `markets.${i}.locale`, message: "A language code such as fr or de-CH. Leave it empty for the store's main language." });
  });
  if (s.markets.length === 0) out.push({ path: "markets", message: "Keep at least one market." });
  if (s.markets.length > 20) out.push({ path: "markets", message: "Up to 20 markets." });

  const t = themeIdProblem(s.links.previewThemeId);
  if (t) out.push({ path: "links.previewThemeId", message: t });
  if (s.links.previewMarket !== "" && !keys.has(s.links.previewMarket)) out.push({ path: "links.previewMarket", message: "Choose one of the markets above." });

  const sale = s.sale;
  const sb = metafieldProblem(sale.badgeNamespace, sale.badgeKey);
  if (sb) out.push({ path: "sale.badgeKey", message: sb });
  if (sale.collectionHandle !== "" && !HANDLE_RE.test(sale.collectionHandle)) out.push({ path: "sale.collectionHandle", message: "A collection handle has lowercase letters, digits and dashes, for example sale. Leave it empty to skip the sale collection check." });

  if (!Number.isInteger(s.activity.eventsLimit) || s.activity.eventsLimit < 1 || s.activity.eventsLimit > MAX_EVENTS) out.push({ path: "activity.eventsLimit", message: `A whole number from 1 to ${MAX_EVENTS}.` });

  if (s.adaptations.length > MAX_ADAPTATIONS) out.push({ path: "adaptations", message: `Up to ${MAX_ADAPTATIONS} adaptations.` });
  const pairs = new Set<string>();
  s.adaptations.forEach((a, i) => {
    if (!LOCALE_RE.test(a.locale)) out.push({ path: `adaptations.${i}.locale`, message: `"${a.locale}" is not a language code.` });
    if (!MARKET_GID_RE.test(a.marketId)) out.push({ path: `adaptations.${i}.marketId`, message: "This market id is not valid." });
    const k = `${a.locale}|${a.marketId}`;
    if (pairs.has(k)) out.push({ path: `adaptations.${i}`, message: "This adaptation is listed twice." });
    pairs.add(k);
  });

  out.push(...healthProblems(s, keys));

  return out;
}

export const rowId = (r: TranslationRow): string => (r.type === "core" ? `core:${r.field}` : r.type === "metafield" ? `mf:${r.namespace}.${r.key}` : r.type === "namespace" ? `ns:${r.namespace}` : r.type);

export function rowLabel(r: TranslationRow): string {
  switch (r.type) {
    case "core":
      return CORE_FIELD_LABEL[r.field];
    case "metafield":
      return `${r.namespace}.${r.key}`;
    case "namespace":
      return `All metafields in "${r.namespace}"`;
    case "optionNames":
      return "Option names";
    case "optionValues":
      return "Option values";
  }
}

// ---------------------------------------------------------------- checking against the store's metafield definitions

export type DefinitionIndex = { product: { namespace: string; key: string }[] | null; variant: { namespace: string; key: string }[] | null };

const has = (list: { namespace: string; key: string }[], namespace: string, key: string) => list.some((d) => d.namespace === namespace && d.key === key);

/** Metafield keys must be real definitions of the store. A list that could not be read (null) is not checked. */
export function problemsAgainstDefinitions(s: BlockSettings, defs: DefinitionIndex): Problem[] {
  const out: Problem[] = [];
  const need = (path: string, owner: "product" | "variant", namespace: string, key: string) => {
    const list = defs[owner];
    if (!list || metafieldProblem(namespace, key)) return;
    if (!has(list, namespace, key)) out.push({ path, message: `The store has no ${owner} metafield definition "${namespace}.${key}". Pick one from the list.` });
  };
  s.translation.rows.forEach((r, i) => {
    if (r.type === "metafield") need(`translation.rows.${i}`, "product", r.namespace, r.key);
    if (r.type === "namespace" && defs.product && !defs.product.some((d) => d.namespace === r.namespace)) out.push({ path: `translation.rows.${i}`, message: `The store has no product metafield definitions in "${r.namespace}".` });
  });
  (["length", "seater", "leadTime"] as const).forEach((g) => s.quality.fields[g].forEach((f, i) => need(`quality.fields.${g}.${i}`, f.owner, f.namespace, f.key)));
  s.quality.checks.forEach((c, i) => c.field && need(`quality.checks.${i}.field`, c.field.owner, c.field.namespace, c.field.key));
  need("sale.badgeKey", "product", s.sale.badgeNamespace, s.sale.badgeKey);
  return out;
}

/** Problems for one section only (a path starts with the section name; "languages" also covers its own rows). */
export const problemsFor = (problems: Problem[], section: SectionId): Problem[] => problems.filter((p) => p.path === section || p.path.startsWith(`${section}.`));

// ---------------------------------------------------------------- reading what is stored

export type ParseSource = "default" | "saved" | "invalid" | "unreadable";
export type ParseResult = { settings: BlockSettings; source: ParseSource; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const bool = (v: unknown): v is boolean => typeof v === "boolean";
const arr = (v: unknown): v is unknown[] => Array.isArray(v);

function coerceField(v: unknown): FieldRef | null {
  if (!isObj(v) || !str(v.label) || !str(v.namespace) || !str(v.key) || (v.owner !== "product" && v.owner !== "variant")) return null;
  return { label: v.label, namespace: v.namespace, key: v.key, owner: v.owner };
}

function coerceList<T>(v: unknown, one: (x: unknown) => T | null): T[] | null {
  if (!arr(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const c = one(x);
    if (c === null) return null;
    out.push(c);
  }
  return out;
}

const strings = (v: unknown): string[] | null => coerceList(v, (x) => (str(x) ? x : null));
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function coerceFlags<K extends string>(v: unknown, keys: readonly K[]): Record<K, boolean> | null {
  if (!isObj(v)) return null;
  const out = {} as Record<K, boolean>;
  for (const k of keys) {
    if (!bool(v[k])) return null;
    out[k] = v[k] as boolean;
  }
  return out;
}

function coerceGroups(v: unknown): GroupsSetting | null {
  if (!isObj(v) || !isObj(v.profiles)) return null;
  const groups = coerceFlags(v.groups, GROUPS);
  const disabledRules = strings(v.disabledRules);
  if (!groups || !disabledRules) return null;
  const profiles = {} as Record<ProfileId, Record<GroupId, boolean>>;
  for (const p of PROFILES) {
    const row = coerceFlags((v.profiles as Record<string, unknown>)[p], GROUPS);
    if (!row) return null;
    profiles[p] = row;
  }
  return { groups, profiles, disabledRules };
}

function coerceThresholds(v: unknown): Thresholds | null {
  if (!isObj(v) || !isObj(v.weights)) return null;
  const { seoTitleMax, seoDescMin, seoDescMax, minImages, altTarget, primaryMarket } = v;
  const w = v.weights;
  if (![seoTitleMax, seoDescMin, seoDescMax, minImages, altTarget, w.blocks, w.hurts, w.nice].every(num) || !str(primaryMarket)) return null;
  return { seoTitleMax: seoTitleMax as number, seoDescMin: seoDescMin as number, seoDescMax: seoDescMax as number, minImages: minImages as number, altTarget: altTarget as number, weights: { blocks: w.blocks as number, hurts: w.hurts as number, nice: w.nice as number }, primaryMarket };
}

function coerceThemeField(x: unknown): ThemeField | null {
  if (!isObj(x) || !str(x.id) || !str(x.label) || !str(x.namespace) || !str(x.key) || !bool(x.on)) return null;
  if (x.owner !== "product" && x.owner !== "variant") return null;
  if (!str(x.rule) || !(THEME_RULES as readonly string[]).includes(x.rule)) return null;
  if (!str(x.severity) || !(SEVERITIES as readonly string[]).includes(x.severity)) return null;
  const profiles = strings(x.profiles);
  if (!profiles) return null;
  let other: ThemeField["other"];
  if (x.other !== undefined) {
    if (!isObj(x.other) || !str(x.other.namespace) || !str(x.other.key)) return null;
    other = { namespace: x.other.namespace, key: x.other.key };
  }
  return { id: x.id, label: x.label, namespace: x.namespace, key: x.key, owner: x.owner, rule: x.rule as ThemeRule, profiles: profiles as ProfileId[], severity: x.severity as Severity, on: x.on, ...(other ? { other } : {}) };
}

function coerceHelpers(v: unknown): HelpersSetting | null {
  if (!isObj(v)) return null;
  const types = strings(v.types);
  const tags = strings(v.tags);
  const titlePatterns = strings(v.titlePatterns);
  const bundleTypes = strings(v.bundleTypes);
  const bundleTags = strings(v.bundleTags);
  const expectedCategories = strings(v.expectedCategories);
  const woodNames = strings(v.woodNames);
  return types && tags && titlePatterns && bundleTypes && bundleTags && expectedCategories && woodNames ? { types, tags, titlePatterns, bundleTypes, bundleTags, expectedCategories, woodNames } : null;
}

function coerceRecords(v: unknown): RecordsSetting | null {
  if (!isObj(v) || !str(v.swatchType) || !str(v.deliveryType) || !str(v.designType)) return null;
  const swatchField = coerceField(v.swatchField);
  const hideField = coerceField(v.hideField);
  return swatchField && hideField ? { swatchType: v.swatchType, deliveryType: v.deliveryType, designType: v.designType, swatchField, hideField } : null;
}

const COERCE: { [K in SectionId]: (v: unknown) => BlockSettings[K] | null } = {
  languages: (v) => coerceList(v, (x) => (isObj(x) && str(x.code) && str(x.label) ? { code: x.code, label: x.label } : null)),
  translation: (v) => {
    if (!isObj(v)) return null;
    const rows = coerceList<TranslationRow>(v.rows, (x) => {
      if (!isObj(x)) return null;
      if (x.type === "core" && str(x.field)) return { type: "core", field: x.field as CoreField };
      if (x.type === "metafield" && str(x.namespace) && str(x.key)) return { type: "metafield", namespace: x.namespace, key: x.key };
      if (x.type === "namespace" && str(x.namespace)) return { type: "namespace", namespace: x.namespace };
      if (x.type === "optionNames" || x.type === "optionValues") return { type: x.type };
      return null;
    });
    return rows ? { rows } : null;
  },
  quality: (v) => {
    if (!isObj(v) || !isObj(v.fields)) return null;
    const checks = coerceList<CheckSetting>(v.checks, (x) => {
      if (!isObj(x) || !str(x.id) || !str(x.kind) || !str(x.label) || !bool(x.on)) return null;
      const field = x.field === undefined ? undefined : coerceField(x.field);
      if (field === null) return null;
      return { id: x.id, kind: x.kind as CheckKind, label: x.label, on: x.on, ...(field ? { field } : {}) };
    });
    const length = coerceList(v.fields.length, coerceField);
    const seater = coerceList(v.fields.seater, coerceField);
    const leadTime = coerceList(v.fields.leadTime, coerceField);
    return checks && length && seater && leadTime ? { checks, fields: { length, seater, leadTime } } : null;
  },
  links: (v) => (isObj(v) && str(v.previewThemeId) && str(v.previewMarket) ? { previewThemeId: v.previewThemeId, previewMarket: v.previewMarket } : null),
  markets: (v) =>
    coerceList(v, (x) =>
      isObj(x) && str(x.key) && str(x.label) && str(x.country) && str(x.domain) && bool(x.stayUs) && str(x.marketHandle) && bool(x.enabled)
        ? { key: x.key, label: x.label, country: x.country, domain: x.domain, stayUs: x.stayUs, marketHandle: x.marketHandle, enabled: x.enabled, locale: str(x.locale) ? x.locale : (MARKETS.find((m) => m.key === x.key)?.locale ?? "") }
        : null,
    ),
  sale: (v) => (isObj(v) && str(v.badgeNamespace) && str(v.badgeKey) && str(v.collectionHandle) ? { badgeNamespace: v.badgeNamespace, badgeKey: v.badgeKey, collectionHandle: v.collectionHandle } : null),
  collections: (v) => (isObj(v) && bool(v.showTags) && bool(v.showType) ? { showTags: v.showTags, showType: v.showType } : null),
  activity: (v) => (isObj(v) && typeof v.eventsLimit === "number" ? { eventsLimit: v.eventsLimit } : null),
  adaptations: (v) => coerceList(v, (x) => (isObj(x) && str(x.locale) && str(x.marketId) && str(x.marketName) ? { locale: x.locale, marketId: x.marketId, marketName: x.marketName } : null)),
  groups: coerceGroups,
  thresholds: coerceThresholds,
  themeFields: (v) => coerceList(v, coerceThemeField),
  helpers: coerceHelpers,
  records: coerceRecords,
};

const SECTION_NAME: Record<SectionId, string> = {
  languages: "Languages",
  translation: "Translation status",
  quality: "Data quality checklist",
  links: "Quick links",
  markets: "Markets",
  sale: "Sale and badge",
  collections: "Collections and tags",
  activity: "Recent activity",
  adaptations: "Market adaptations",
  groups: "Health check groups",
  thresholds: "Thresholds",
  themeFields: "Theme fields",
  helpers: "Helper product rules",
  records: "Linked records",
};
export const sectionName = (id: SectionId) => SECTION_NAME[id];

/**
 * Turns the stored text (or an already parsed value) into settings the blocks can use. Never throws.
 * A section that is missing takes its default quietly (an older save). A section that is wrong takes its default and
 * is reported in `problems`, so one bad part does not hide the rest.
 */
/**
 * Version 1 -> 2. The sections that did not exist take their defaults (parseSettings does that for every missing
 * section); what is added here is the one thing a default cannot know: a single check the person had switched off in
 * version 1 stays off (the health groups have their own list of switched-off checks). Everything else is kept as saved.
 * Pure: returns a new object.
 */
export function migrateSettings(data: Record<string, unknown>): Record<string, unknown> {
  const version = typeof data.version === "number" ? data.version : 1;
  if (version >= SETTINGS_VERSION) return data;
  const out: Record<string, unknown> = { ...data, version: SETTINGS_VERSION };
  const quality = data.quality;
  if (data.groups === undefined && isObj(quality) && arr(quality.checks)) {
    const off = new Set<string>();
    for (const c of quality.checks) {
      if (isObj(c) && c.on === false && str(c.kind)) for (const id of LEGACY_CHECK_RULES[c.kind] ?? []) off.add(id);
    }
    if (off.size) out.groups = { ...defaultGroups(), disabledRules: [...off] };
  }
  return out;
}

export function parseWith(raw: unknown, validate: (s: BlockSettings) => Problem[]): ParseResult {
  const base = defaultSettings();
  if (raw === null || raw === undefined || raw === "") return { settings: base, source: "default", problems: [] };
  let data: unknown = raw;
  if (str(raw)) {
    if (raw.length > MAX_SETTINGS_CHARS) return { settings: base, source: "invalid", problems: ["The saved settings are too long to be right."] };
    try {
      data = JSON.parse(raw);
    } catch {
      return { settings: base, source: "invalid", problems: ["The saved settings are not valid JSON."] };
    }
  }
  if (!isObj(data)) return { settings: base, source: "invalid", problems: ["The saved settings are not an object."] };
  if (typeof data.version === "number" && data.version > SETTINGS_VERSION) {
    return { settings: base, source: "invalid", problems: [`The saved settings are version ${data.version}, newer than this app understands.`] };
  }
  const saved = migrateSettings(data);

  const problems: string[] = [];
  const out = structuredClone(base) as Record<SectionId, unknown>;
  for (const id of SECTIONS) {
    if (saved[id] === undefined) continue;
    const coerced = COERCE[id](saved[id]);
    if (coerced === null) {
      problems.push(`${SECTION_NAME[id]}: the saved values are not in the right shape.`);
      continue;
    }
    out[id] = coerced;
    // Value rules, judged on the whole object with this section replaced.
    const candidate = { ...(base as Record<SectionId, unknown>), [id]: coerced } as unknown as BlockSettings;
    const bad = problemsFor(validate(candidate), id);
    if (bad.length) {
      problems.push(`${SECTION_NAME[id]}: ${bad[0]!.message}`);
      out[id] = structuredClone(base[id]);
    }
  }
  const settings = { ...(out as unknown as BlockSettings), version: SETTINGS_VERSION };
  // A preview market that no longer exists falls back with the markets list that is in use.
  if (settings.links.previewMarket !== "" && !settings.markets.some((m) => m.key === settings.links.previewMarket)) settings.links = { ...settings.links, previewMarket: settings.markets[0]?.key ?? "" };
  return { settings, source: problems.length ? "invalid" : "saved", problems };
}

/** Reads stored settings with every value rule (the Settings page and the tests). */
export const parseSettings = (raw: unknown): ParseResult => parseWith(raw, problemsOf);

/**
 * The few value rules the blocks apply when they read the settings: the ones that would break a request (language and
 * country codes). The full rules (problemsOf) run on the Settings page before anything is saved, and they are kept out
 * of the blocks to keep the bundles small.
 */
export function problemsForBlocks(s: BlockSettings): Problem[] {
  const out: Problem[] = [];
  if (s.languages.length === 0) out.push({ path: "languages", message: "Choose at least one language." });
  s.languages.forEach((l, i) => {
    if (!LOCALE_RE.test(l.code)) out.push({ path: `languages.${i}.code`, message: `"${l.code}" is not a language code.` });
  });
  if (s.markets.length === 0) out.push({ path: "markets", message: "Keep at least one market." });
  s.markets.forEach((m, i) => {
    if (!COUNTRY_RE.test(m.country)) out.push({ path: `markets.${i}.country`, message: "A two-letter country code in capitals, for example GB." });
    if (m.locale !== "" && !LOCALE_RE.test(m.locale)) out.push({ path: `markets.${i}.locale`, message: "A language code such as fr or de-CH." });
  });
  s.adaptations.forEach((a, i) => {
    if (!LOCALE_RE.test(a.locale)) out.push({ path: `adaptations.${i}.locale`, message: `"${a.locale}" is not a language code.` });
  });
  return out;
}

export const serializeSettings = (s: BlockSettings): string => JSON.stringify({ ...s, version: SETTINGS_VERSION });

/** The markets the blocks show (turned on). */
export const enabledMarkets = (s: BlockSettings): MarketSetting[] => s.markets.filter((m) => m.enabled);

// ---------------------------------------------------------------- the query the blocks use to read the settings

export const SETTINGS_QUERY = `query BlockSettings {
  currentAppInstallation {
    metafield(namespace: "${SETTINGS_NAMESPACE}", key: "${SETTINGS_KEY}") { value }
  }
}`;

export type SettingsRead = ParseResult & { notice: string | null };

/** Reads and checks the settings. `read` is the block's soft query. Never throws: any trouble means the defaults. */
export type SettingsRaw = { currentAppInstallation?: { metafield?: { value?: string | null } | null } | null };
export async function readSettings(read: (query: string) => Promise<{ data: SettingsRaw | null; error: { message: string } | null }>): Promise<SettingsRead> {
  try {
    const { data, error } = await read(SETTINGS_QUERY);
    if (error && !data) {
      return { settings: defaultSettings(), source: "unreadable", problems: [error.message], notice: "Settings could not be read, so the default settings are used." };
    }
    const result = parseWith(data?.currentAppInstallation?.metafield?.value ?? null, problemsForBlocks);
    return { ...result, notice: result.source === "invalid" ? "Some saved settings could not be used, so the defaults are used for them. Open Settings in the app to fix it." : null };
  } catch (e) {
    return { settings: defaultSettings(), source: "unreadable", problems: [e instanceof Error ? e.message : String(e)], notice: "Settings could not be read, so the default settings are used." };
  }
}

// ---------------------------------------------------------------- helpers for the blocks

/** The settings a block works with: the saved ones, or today's defaults when none were given. */
export const settingsOf = (ctx: { settings?: BlockSettings }): BlockSettings => ctx.settings ?? defaultSettings();

/** The markets the blocks list, in the shape the block code uses. */
export function marketDefs(s: BlockSettings): MarketDef[] {
  return enabledMarkets(s).map((m) => ({ key: m.key, label: m.label, country: m.country, domain: m.domain, stayUs: m.stayUs, ...(m.marketHandle ? { marketHandle: m.marketHandle } : {}), ...(m.locale ? { locale: m.locale } : {}) }));
}

/** Countries of the listed markets, each once. */
export const marketCountries = (defs: MarketDef[]): string[] => [...new Set(defs.map((m) => m.country))];
