// The rules engine of the health checks. Pure: facts + settings in, results out. No Shopify, no Preact.
//
// Every check returns pass / fail / na (does not apply to this kind of product, or nothing to judge) / unknown (the
// data could not be read). The blocks show pass, fail and unknown; a check that does not apply is never shown.
// Product health, Data quality and the Content snapshot all call this file, so they always agree.

import { plural, shortList } from "./format";
import { fieldAlias, isBlank, looksSpaced, sameText, textOf, type MetaValue, type ProductFacts, type VariantFact } from "./facts";
import type { MarketState } from "./markets";
import { looksLikeTest, deliveryKeys, matchDelivery, type RecordsFacts } from "./records";
import {
  GROUPS,
  PROFILES,
  RULE_CATALOGUE,
  SEVERITIES,
  type BlockSettings,
  type FieldRef,
  type GroupId,
  type HelpersSetting,
  type ProfileId,
  type RuleInfo,
  type Severity,
  type ThemeField,
} from "./settings";

export type CheckStatus = "pass" | "fail" | "na" | "unknown";
export type AdminLink = { href: string; label: string };

export type CheckResult = {
  id: string;
  group: GroupId;
  label: string;
  severity: Severity;
  status: CheckStatus;
  /** One short line: why it failed, or why it could not be judged. Empty on pass. */
  reason: string;
  /** The exact field name to look at, for example "SEO description" or "custom.tag_line". */
  field: string;
  link: AdminLink | null;
  /** A few examples (first five). */
  items: string[];
};

// ---------------------------------------------------------------- profile

export type ProfileGuess = { profile: ProfileId; reason: string };

const lower = (s: string) => s.trim().toLowerCase();
const inList = (list: string[], value: string) => list.some((x) => lower(x) === lower(value));

/** "* finish" matches any title that ends with "finish". Without * it matches a word inside the title. */
export function titleMatches(pattern: string, title: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const body = p.includes("*") ? escaped.replace(/\*/g, ".*") : `(^|\\W)${escaped}(\\W|$)`;
  try {
    return new RegExp(p.includes("*") ? `^${body}$` : body, "i").test(title.trim());
  } catch {
    return false;
  }
}

/** Real product, Option product or Bundle, guessed from the type, category, tags and title. */
export function detectProfile(f: Pick<ProductFacts, "productType" | "category" | "tags" | "title">, h: HelpersSetting): ProfileGuess {
  const type = f.productType.trim();
  if (type && inList(h.bundleTypes, type)) return { profile: "bundle", reason: `Type "${type}" is in the bundle list` };
  const bundleTag = f.tags.find((t) => inList(h.bundleTags, t));
  if (bundleTag) return { profile: "bundle", reason: `Tag "${bundleTag}" is in the bundle list` };
  if (type && inList(h.types, type)) return { profile: "option", reason: `Type "${type}" is in the helper list` };
  if (f.category && inList(h.types, f.category)) return { profile: "option", reason: `Category "${f.category}" is in the helper list` };
  const tag = f.tags.find((t) => inList(h.tags, t));
  if (tag) return { profile: "option", reason: `Tag "${tag}" is in the helper list` };
  const pattern = h.titlePatterns.find((p) => titleMatches(p, f.title));
  if (pattern) return { profile: "option", reason: `The title matches "${pattern}"` };
  return { profile: "real", reason: "No helper rule matches" };
}

// ---------------------------------------------------------------- links

const recordUrl = (o: { type: string; id: string }) => `shopify:admin/content/metaobjects/entries/${o.type}/${o.id.split("/").pop()}`;

const productHref = (f: ProductFacts, anchor = "") => `shopify:admin/products/${f.numericId}${anchor ? `#${anchor}` : ""}`;
const link = (f: ProductFacts, anchor = ""): AdminLink => ({ href: productHref(f, anchor), label: "Open in admin" });
const variantLink = (f: ProductFacts, v: VariantFact): AdminLink => ({ href: `shopify:admin/products/${f.numericId}/variants/${v.id.split("/").pop()}`, label: "Open the variant" });

// ---------------------------------------------------------------- the report

export type HealthInput = {
  facts: ProductFacts;
  settings: BlockSettings;
  /** The kind of product to judge as. Missing = the guess. */
  profile?: ProfileId;
  /** Published state per listed market (shared reader). null = could not be read. */
  markets?: MarketState[] | null;
  records?: RecordsFacts | null;
};

export type HealthReport = {
  guess: ProfileGuess;
  profile: ProfileId;
  results: CheckResult[];
  /** Pass, fail and unknown only. */
  shown: CheckResult[];
  pending: Record<Severity, CheckResult[]>;
  counts: Record<Severity, number>;
  passed: number;
  counted: number;
  /** 0 to 100, or null when nothing could be judged. */
  score: number | null;
  verdict: string;
  notApplicable: number;
};

function summarize(results: CheckResult[], weights: Record<Severity, number>): Pick<HealthReport, "shown" | "pending" | "counts" | "passed" | "counted" | "score" | "verdict" | "notApplicable"> {
  const shown = results.filter((r) => r.status !== "na");
  const judged = shown.filter((r) => r.status === "pass" || r.status === "fail");
  const pending = { blocks: [], hurts: [], nice: [] } as Record<Severity, CheckResult[]>;
  for (const r of shown) if (r.status === "fail") pending[r.severity].push(r);
  const counts = { blocks: 0, hurts: 0, nice: 0 } as Record<Severity, number>;
  for (const sev of SEVERITIES) counts[sev] = pending[sev].length;
  const total = judged.reduce((n, r) => n + weights[r.severity], 0);
  const earned = judged.filter((r) => r.status === "pass").reduce((n, r) => n + weights[r.severity], 0);
  const score = judged.length === 0 ? null : total === 0 ? 100 : Math.round((earned / total) * 100);
  const toFix = counts.blocks + counts.hurts;
  const verdict = judged.length === 0 ? "Nothing to check" : toFix > 0 ? `${toFix} to fix before launch` : counts.nice > 0 ? `Ready, ${counts.nice} nice to have` : "Ready";
  return { shown, pending, counts, passed: judged.filter((r) => r.status === "pass").length, counted: judged.length, score, verdict, notApplicable: results.length - shown.length };
}

/** Variants whose compare-at price is not a real discount. Shared with the Sale and badge block, so both say the same. */
export function compareAtIssues(variants: VariantFact[]): { equal: VariantFact[]; lower: VariantFact[] } {
  const both = variants.filter((v) => v.compareAt !== null && v.price !== null);
  return { equal: both.filter((v) => v.compareAt === v.price), lower: both.filter((v) => (v.compareAt as number) < (v.price as number)) };
}

// ---------------------------------------------------------------- the rules

type Ctx = HealthInput & { profile: ProfileId };

const catalogue = new Map<string, RuleInfo>(RULE_CATALOGUE.map((r) => [r.id, r]));

function active(info: Pick<RuleInfo, "group" | "only"> & { id?: string }, c: Ctx): boolean {
  const g = c.settings.groups;
  if (!g.groups[info.group] || !g.profiles[c.profile][info.group]) return false;
  if (info.id && g.disabledRules.includes(info.id)) return false;
  return !info.only || info.only.includes(c.profile);
}

const firstFive = (list: string[]) => list.slice(0, 5);
const q = (s: string) => `"${s}"`;

function evaluateRule(id: string, c: Ctx): CheckResult[] {
  const info = catalogue.get(id);
  if (!info || !active(info, c)) return [];
  const f = c.facts;
  const t = c.settings.thresholds;
  const h = c.settings.helpers;
  const base = { id, group: info.group, label: info.label, severity: info.severity };
  const pass = (field: string): CheckResult => ({ ...base, status: "pass", reason: "", field, link: null, items: [] });
  const fail = (field: string, reason: string, lnk: AdminLink | null, items: string[] = [], severity: Severity = info.severity): CheckResult => ({ ...base, severity, status: "fail", reason, field, link: lnk, items: firstFive(items) });
  const na = (field: string, reason = ""): CheckResult => ({ ...base, status: "na", reason, field, link: null, items: [] });
  const unknown = (field: string, reason: string): CheckResult => ({ ...base, status: "unknown", reason, field, link: null, items: [] });
  const need = (state: string, field: string): CheckResult | null => (state === "skipped" ? na(field) : state === "failed" ? unknown(field, "Could not be read.") : null);

  switch (id) {
    case "basics.body": {
      const gate = need(f.read.content, "Description");
      if (gate) return [gate];
      return [f.bodyWords > 0 ? pass("Description") : fail("Description", "The description is empty.", link(f))];
    }
    case "basics.type":
      return [f.productType.trim() ? pass("Product type") : fail("Product type", "The product type is empty.", link(f, "organization"))];
    case "basics.typeWood": {
      if (!f.productType.trim()) return [na("Product type")];
      const norm = lower(f.productType).replace(/_/g, " ");
      const wood = h.woodNames.some((w) => lower(w).replace(/_/g, " ") === norm);
      const hint = h.expectedCategories.length ? ` Use a category such as ${shortList(h.expectedCategories, 3)}.` : "";
      return [wood ? fail("Product type", `The type ${q(f.productType)} is a wood or material name, not a category.${hint}`, link(f, "organization")) : pass("Product type")];
    }
    case "basics.typeList": {
      if (!f.productType.trim() || h.expectedCategories.length === 0) return [na("Product type")];
      return [inList(h.expectedCategories, f.productType) ? pass("Product type") : fail("Product type", `${q(f.productType)} is not one of: ${shortList(h.expectedCategories, 4)}.`, link(f, "organization"))];
    }
    case "basics.duplicateTitle": {
      const gate = need(f.read.duplicates, "Title");
      if (gate) return [gate];
      return [f.duplicates.length === 0 ? pass("Title") : fail("Title", `Same title as ${plural(f.duplicates.length, "other product")}: ${shortList(f.duplicates.map((d) => d.handle), 3)}.`, link(f), f.duplicates.map((d) => d.handle))];
    }
    case "seo.title": {
      const gate = need(f.read.content, "SEO title");
      if (gate) return [gate];
      return [f.seoTitle.trim() ? pass("SEO title") : fail("SEO title", "The SEO title is empty.", link(f, "seo"))];
    }
    case "seo.titleLength": {
      if (need(f.read.content, "SEO title") || !f.seoTitle.trim()) return [na("SEO title")];
      const n = f.seoTitle.trim().length;
      return [n <= t.seoTitleMax ? pass("SEO title") : fail("SEO title", `${n} characters; keep it to ${t.seoTitleMax} or fewer.`, link(f, "seo"))];
    }
    case "seo.desc": {
      const gate = need(f.read.content, "SEO description");
      if (gate) return [gate];
      return [f.seoDescription.trim() ? pass("SEO description") : fail("SEO description", "The SEO description is empty.", link(f, "seo"))];
    }
    case "seo.descLength": {
      if (need(f.read.content, "SEO description") || !f.seoDescription.trim()) return [na("SEO description")];
      const n = f.seoDescription.trim().length;
      if (n < t.seoDescMin) return [fail("SEO description", `${n} characters; aim for ${t.seoDescMin} to ${t.seoDescMax}.`, link(f, "seo"))];
      if (n > t.seoDescMax) return [fail("SEO description", `${n} characters; keep it to ${t.seoDescMax} or fewer.`, link(f, "seo"))];
      return [pass("SEO description")];
    }
    case "images.count": {
      const gate = need(f.read.media, "Images");
      if (gate) return [gate];
      if (t.minImages === 0) return [na("Images")];
      return [f.images.length >= t.minImages ? pass("Images") : fail("Images", `${plural(f.images.length, "image")}; at least ${t.minImages} needed.`, link(f, "media"))];
    }
    case "images.alt": {
      const gate = need(f.read.media, "Image alt text");
      if (gate) return [gate];
      if (f.images.length === 0) return [na("Image alt text")];
      const missing = f.images.map((m, i) => ({ m, i })).filter(({ m }) => !m.alt.trim());
      const covered = f.images.length - missing.length;
      const percent = (covered / f.images.length) * 100;
      return [percent >= t.altTarget ? pass("Image alt text") : fail("Image alt text", `${covered} of ${plural(f.images.length, "image")} have alt text (target ${t.altTarget}%).`, link(f, "media"), missing.map(({ i }) => `Image ${i + 1}`))];
    }
    case "variants.price": {
      const gate = need(f.read.variants, "Price");
      if (gate) return [gate];
      if (f.variants.length === 0) return [fail("Price", "The product has no variants.", link(f, "variants"))];
      const bad = f.variants.filter((v) => !((v.price ?? 0) > 0));
      return [bad.length ? fail("Price", `${plural(bad.length, "variant")} priced at 0 or less.`, variantLink(f, bad[0]!), bad.map((v) => v.title)) : pass("Price")];
    }
    case "variants.compareLower": {
      const gate = need(f.read.variants, "Compare-at price");
      if (gate) return [gate];
      const bad = compareAtIssues(f.variants).lower;
      return [bad.length ? fail("Compare-at price", `${plural(bad.length, "variant")} with a compare-at price below the price.`, variantLink(f, bad[0]!), bad.map((v) => v.title)) : pass("Compare-at price")];
    }
    case "variants.compareEqual": {
      const gate = need(f.read.variants, "Compare-at price");
      if (gate) return [gate];
      const bad = compareAtIssues(f.variants).equal;
      return [bad.length ? fail("Compare-at price", `${plural(bad.length, "variant")} with a compare-at price equal to the price (no discount).`, variantLink(f, bad[0]!), bad.map((v) => v.title)) : pass("Compare-at price")];
    }
    case "variants.sku":
    case "variants.weight":
    case "variants.cost": {
      const field = id === "variants.sku" ? "SKU" : id === "variants.weight" ? "Weight" : "Cost per item";
      const gate = need(f.read.variants, field) ?? need(f.read.variantExtras, field);
      if (gate) return [gate];
      const bad = f.variants.filter((v) => (id === "variants.sku" ? !(v.sku ?? "").trim() : id === "variants.weight" ? !((v.weight ?? 0) > 0) : v.cost === null || v.cost === undefined));
      const what = id === "variants.sku" ? "no SKU" : id === "variants.weight" ? "no weight" : "no cost per item";
      return [bad.length ? fail(field, `${bad.length} of ${plural(f.variants.length, "variant")} ${bad.length === 1 ? "has" : "have"} ${what}.`, variantLink(f, bad[0]!), bad.map((v) => v.title)) : pass(field)];
    }
    case "variants.spaces": {
      const gate = need(f.read.variants, "Variant titles");
      if (gate) return [gate];
      const bad = f.variants.filter((v) => looksSpaced(v.title) || v.selectedOptions.some((o) => looksSpaced(o.value)));
      return [bad.length ? fail("Variant titles", `${plural(bad.length, "variant")} with an extra space: ${shortList(bad.map((v) => q(v.title)), 3)}.`, variantLink(f, bad[0]!), bad.map((v) => q(v.title))) : pass("Variant titles")];
    }
    case "variants.image": {
      const gate = need(f.read.variants, "Variant images") ?? need(f.read.variantExtras, "Variant images");
      if (gate) return [gate];
      if (!f.variants.some((v) => v.hasImage)) return [na("Variant images")];
      const bad = f.variants.filter((v) => !v.hasImage);
      return [bad.length ? fail("Variant images", `${plural(bad.length, "variant")} without an image while others have one.`, variantLink(f, bad[0]!), bad.map((v) => v.title)) : pass("Variant images")];
    }
    case "variants.dupValues": {
      if (f.options.length === 0) return [na("Option values")];
      const dups = f.options.flatMap((o) => {
        const seen = new Set<string>();
        const twice: string[] = [];
        for (const v of o.values) {
          const k = lower(v).replace(/\s+/g, " ");
          if (seen.has(k)) twice.push(`${o.name}: ${q(v)}`);
          seen.add(k);
        }
        return twice;
      });
      return [dups.length ? fail("Option values", `A value is listed twice after trimming: ${shortList(dups, 3)}.`, link(f, "variants"), dups) : pass("Option values")];
    }
    case "theme.lengthSeater":
    case "theme.lead": {
      const kind = id === "theme.lengthSeater" ? "lengthSeater" : "lead";
      const check = c.settings.quality.checks.find((x) => x.kind === kind);
      if (check && !check.on) return [];
      const fields = kind === "lengthSeater" ? [...c.settings.quality.fields.length, ...c.settings.quality.fields.seater] : c.settings.quality.fields.leadTime;
      if (fields.length === 0) return [na(info.label)];
      return [filledResult(info, c, fields, info.label)];
    }
    case "markets.any": {
      const gate = need(f.read.publications, "Markets");
      if (gate) return [gate];
      return [f.publishedCatalogIds.length ? pass("Markets") : fail("Markets", "Not in any market catalogue.", link(f, "markets"))];
    }
    case "markets.spread": {
      if (!c.markets) return [unknown("Markets", "Market list could not be read.")];
      const real = c.markets.filter((m) => m.state !== "no-market");
      const out = real.filter((m) => m.state === "not-published");
      if (real.length === 0 || out.length === real.length) return [na("Markets")];
      if (out.length === 0) return [pass("Markets")];
      const primary = c.markets.find((m) => m.def.key === t.primaryMarket);
      const severity: Severity = primary?.state === "published" ? "hurts" : "nice";
      return [fail("Markets", `Published in ${real.length - out.length} of ${real.length} markets; not in ${shortList(out.map((m) => m.def.key), 4)}.`, link(f, "markets"), out.map((m) => m.def.key), severity)];
    }
    case "linked.swatches":
      return [linkedSwatches(info, c)].filter((x): x is CheckResult => !!x);
    case "linked.delivery":
      return [linkedDelivery(info, c)].filter((x): x is CheckResult => !!x);
    case "linked.design":
      return [linkedDesign(info, c)].filter((x): x is CheckResult => !!x);
    default:
      return [];
  }
}

// ---------------------------------------------------------------- theme fields

type Basic = Pick<RuleInfo, "id" | "group" | "label" | "severity">;
const resultOf = (b: Basic, status: CheckStatus, field: string, reason: string, lnk: AdminLink | null, items: string[] = [], severity: Severity = b.severity): CheckResult => ({ id: b.id, group: b.group, label: b.label, severity, status, reason, field, link: lnk, items: firstFive(items) });

/** A list of metafields that must all be filled: the product ones once, the variant ones on every variant. */
function filledResult(info: Basic, c: Ctx, fields: FieldRef[], field: string): CheckResult {
  const f = c.facts;
  const problems: string[] = [];
  const items: string[] = [];
  for (const m of fields) {
    const a = fieldAlias(m);
    if (m.owner === "variant") {
      if (f.read.variants !== "ok") return resultOf(info, "unknown", field, "Variants could not be read.", null);
      const missing = f.variants.filter((v) => isBlank(v.fields[a]));
      if (missing.length) {
        problems.push(`${m.label} is empty on ${missing.length} of ${plural(f.variants.length, "variant")}`);
        items.push(...missing.map((v) => `${m.label}: ${v.title}`));
      }
    } else if (isBlank(f.fields[a])) {
      problems.push(`${m.label} is empty`);
      items.push(m.label);
    }
  }
  const first = fields.find((m) => m.owner === "variant" && f.variants.some((v) => isBlank(v.fields[fieldAlias(m)])));
  const lnk = problems.length ? (first ? variantLink(f, f.variants.find((v) => isBlank(v.fields[fieldAlias(first)]))!) : link(f)) : null;
  return problems.length ? resultOf(info, "fail", field, `${problems.join("; ")}.`, lnk, items) : resultOf(info, "pass", field, "", null);
}

const BOOLEAN_OK = /^(true|false|0|1)$/;

function themeResult(tf: ThemeField, c: Ctx): CheckResult {
  const f = c.facts;
  const b: Basic = { id: `theme:${tf.id}`, group: "theme", label: tf.label, severity: tf.severity };
  const name = `${tf.namespace}.${tf.key}`;
  const to = link(f, "metafields");
  const alias = fieldAlias(tf);
  const na = () => resultOf(b, "na", name, "", null);
  const values: { where: string; meta: MetaValue | null; v?: VariantFact }[] =
    tf.owner === "variant" ? f.variants.map((v) => ({ where: v.title, meta: v.fields[alias] ?? null, v })) : [{ where: "", meta: f.fields[alias] ?? null }];
  if (tf.owner === "variant" && f.read.variants !== "ok") return resultOf(b, "unknown", name, "Variants could not be read.", null);
  const where = (x: { where: string }) => (x.where ? `${x.where}: ` : "");
  const lnkFor = (x: { v?: VariantFact }) => (x.v ? variantLink(f, x.v) : to);

  switch (tf.rule) {
    case "filled": {
      const bad = values.filter((x) => isBlank(x.meta));
      return bad.length ? resultOf(b, "fail", name, tf.owner === "variant" ? `Empty on ${bad.length} of ${plural(values.length, "variant")}.` : "The metafield is empty.", lnkFor(bad[0]!), bad.map((x) => x.where || name)) : resultOf(b, "pass", name, "", null);
    }
    case "clean": {
      const empty = values.filter((x) => isBlank(x.meta));
      if (empty.length) return resultOf(b, "fail", name, tf.owner === "variant" ? `Empty on ${empty.length} of ${plural(values.length, "variant")}.` : "The metafield is empty.", lnkFor(empty[0]!), empty.map((x) => x.where || name));
      const spaced = values.filter((x) => looksSpaced(textOf(x.meta)));
      return spaced.length ? resultOf(b, "fail", name, `Extra spaces in ${shortList(spaced.map((x) => `${where(x)}${q(textOf(x.meta))}`), 2)}.`, lnkFor(spaced[0]!), spaced.map((x) => `${where(x)}${q(textOf(x.meta))}`)) : resultOf(b, "pass", name, "", null);
    }
    case "boolean": {
      const filled = values.filter((x) => !isBlank(x.meta));
      if (filled.length === 0) return na();
      const bad = filled.filter((x) => !BOOLEAN_OK.test(textOf(x.meta).trim().toLowerCase()) || textOf(x.meta) !== textOf(x.meta).trim());
      return bad.length ? resultOf(b, "fail", name, `Value ${shortList(bad.map((x) => q(textOf(x.meta))), 2)} is not true, false, 0 or 1.`, lnkFor(bad[0]!), bad.map((x) => `${where(x)}${q(textOf(x.meta))}`)) : resultOf(b, "pass", name, "", null);
    }
    case "sameAs": {
      if (!tf.other) return na();
      const mine = textOf(f.fields[alias]);
      const theirs = textOf(f.fields[fieldAlias(tf.other)]);
      if (!mine.trim() || !theirs.trim()) return na();
      if (mine.trim() === theirs.trim()) return resultOf(b, "pass", name, "", null);
      const caseOnly = sameText(mine, theirs);
      return resultOf(b, "fail", name, caseOnly ? `${q(mine.trim())} and ${q(theirs.trim())} differ in capitals only.` : `${q(mine.trim())} does not match ${q(theirs.trim())} (${tf.other.namespace}.${tf.other.key}).`, to, [mine.trim(), theirs.trim()]);
    }
    case "handles":
    case "targets": {
      if (isBlank(f.fields[alias])) return na();
      if (f.read.linked === "failed") return resultOf(b, "unknown", name, "The listed products could not be looked up.", null);
      if (f.read.linked !== "ok") return na();
      const list = f.linked[alias] ?? [];
      const problems: string[] = [];
      for (const l of list) {
        if (!l.found) problems.push(`${l.handle} does not exist`);
        else if (tf.rule === "handles" && l.self) problems.push(`${l.handle} is this product`);
        else if (tf.rule === "handles" && !l.published) problems.push(`${l.handle} is not published`);
      }
      return problems.length ? resultOf(b, "fail", name, `${shortList(problems, 3)}.`, to, problems) : resultOf(b, "pass", name, "", null);
    }
  }
}

// ---------------------------------------------------------------- linked records

const groupOf = (o: { fields: Record<string, string | null> }) => o.fields.group ?? o.fields.group_name ?? null;

function linkedSwatches(info: RuleInfo, c: Ctx): CheckResult | null {
  const f = c.facts;
  const s = c.settings.records;
  if (!s.swatchType) return null;
  const a = fieldAlias(s.swatchField);
  const ids = [...new Set(f.variants.flatMap((v) => (v.fields[a]?.value ? [v.fields[a]!.value!] : [])).flatMap((x) => x.match(/gid:\/\/shopify\/Metaobject\/\d+/g) ?? []))];
  if (ids.length === 0) return resultOf(info, "na", "Swatches", "", null);
  const r = c.records;
  if (!r || r.state === "skipped") return null;
  const objects = ids.map((id) => r.linked[id]).filter((x): x is NonNullable<typeof x> => !!x && (x.type === s.swatchType || s.swatchType === ""));
  if (objects.length === 0) return r.state === "failed" ? resultOf(info, "unknown", "Swatches", "Swatch records could not be read. They need the metaobject permission.", null) : resultOf(info, "na", "Swatches", "", null);
  const problems: string[] = [];
  const first = objects[0]!;
  const entry = recordUrl;
  let bad: (typeof objects)[number] | null = null;
  for (const o of objects) {
    const why: string[] = [];
    if (o.status === "DRAFT") why.push("is a draft");
    if (o.fields.group !== undefined && !(o.fields.group ?? "").trim()) why.push("has no group");
    if (o.fields.group_key !== undefined && !(o.fields.group_key ?? "").trim()) why.push("has no group key");
    if (looksLikeTest(groupOf(o)) || looksLikeTest(o.displayName)) why.push("looks like test data");
    if (why.length) {
      problems.push(`${o.displayName || o.handle} ${why.join(", ")}`);
      bad ??= o;
    }
  }
  return problems.length ? resultOf(info, "fail", "Swatch records", `${shortList(problems, 2)}.`, { href: entry(bad ?? first), label: "Open the swatch record" }, problems) : resultOf(info, "pass", "Swatch records", "", null);
}

function linkedDelivery(info: RuleInfo, c: Ctx): CheckResult | null {
  const s = c.settings.records;
  if (!s.deliveryType) return null;
  const keys = deliveryKeys(c.facts, c.settings);
  if (keys.length === 0) return resultOf(info, "na", "Delivery time", "", null);
  const r = c.records;
  if (!r || r.state === "skipped") return null;
  if (r.delivery === null) return resultOf(info, "unknown", "Delivery time", "Delivery-time records could not be read. They need the metaobject permission.", null);
  const hits = matchDelivery(r.delivery, keys);
  if (hits.some((h) => h.status === "ACTIVE" || h.status === null)) return resultOf(info, "pass", "Delivery time", "", null);
  const to = (o: { type: string; id: string }): AdminLink => ({ href: recordUrl(o), label: "Open the delivery-time record" });
  if (hits.length) return resultOf(info, "fail", "Delivery time", `The delivery-time record for ${q(keys[0]!)} is a draft.`, to(hits[0]!), hits.map((h) => h.displayName || h.handle));
  return resultOf(info, "fail", "Delivery time", `No delivery-time record found for ${shortList(keys.map(q), 2)}.`, link(c.facts, "metafields"));
}

function linkedDesign(info: RuleInfo, c: Ctx): CheckResult | null {
  const s = c.settings.records;
  if (!s.designType) return null;
  const r = c.records;
  if (!r || r.state === "skipped") return null;
  const objects = Object.values(r.linked).filter((o) => o.type === s.designType);
  if (objects.length === 0) return resultOf(info, "na", "Design records", "", null);
  const bad = objects.filter((o) => o.fields.link !== undefined && !(o.fields.link ?? "").trim());
  return bad.length ? resultOf(info, "fail", "Design records", `${plural(bad.length, "design record")} without a link.`, { href: recordUrl(bad[0]!), label: "Open the record" }, bad.map((o) => o.displayName || o.handle)) : resultOf(info, "pass", "Design records", "", null);
}

// ---------------------------------------------------------------- entry points

/** Runs every active check for the product and summarises the result. */
export function evaluateHealth(input: HealthInput): HealthReport {
  const guess = detectProfile(input.facts, input.settings.helpers);
  const profile = input.profile ?? guess.profile;
  const c: Ctx = { ...input, profile };
  const results: CheckResult[] = [];
  for (const info of RULE_CATALOGUE) results.push(...evaluateRule(info.id, c));

  const themeOn = c.settings.groups.groups.theme && c.settings.groups.profiles[profile].theme;
  if (themeOn) {
    for (const tf of c.settings.themeFields) if (tf.on && tf.profiles.includes(profile)) results.push(themeResult(tf, c));
    for (const check of c.settings.quality.checks) {
      if (check.kind !== "metafield" || !check.on || !check.field) continue;
      const b: Basic = { id: `theme.custom:${check.id}`, group: "theme", label: check.label, severity: "hurts" };
      results.push({ ...filledResult(b, c, [check.field], `${check.field.namespace}.${check.field.key}`), id: b.id, label: b.label });
    }
  }
  // Keep the order of the groups, then of the rules.
  const order = new Map<GroupId, number>(GROUPS.map((g, i) => [g, i]));
  results.sort((a, b) => (order.get(a.group) ?? 0) - (order.get(b.group) ?? 0));
  return { guess, profile, results, ...summarize(results, c.settings.thresholds.weights) };
}

export { PROFILES };
