// The settings of the seven Product Insights blocks: tabs, resets, a plain-words list of what changed, and the guarded save.
//
// Where they live: ONE json metafield, `$app` / `block_settings`, on the app installation (the same place as the editor's
// saved sets). The blocks read it when they load; if it is missing or broken they use today's defaults. The rules for the
// values, the defaults and the reader live in extensions/shared/settings.ts (the blocks and this page use the same code).
//
// Reading is free. Saving is a mutation: the page reviews the changes, asks for a ticked confirmation and the password,
// checks that nobody else saved in the meantime, writes, and reads the value back.

import {
  GROUPS,
  GROUP_LABEL,
  PROFILES,
  PROFILE_LABEL,
  RULE_CATALOGUE,
  SEVERITY_LABEL,
  THEME_RULE_LABEL,
  CHECK_CATALOGUE,
  CORE_FIELD_LABEL,
  SETTINGS_KEY,
  SETTINGS_NAMESPACE,
  defaultSettings,
  parseSettings,
  problemsOf,
  rowLabel,
  serializeSettings,
  type BlockSettings,
  type CheckSetting,
  type FieldRef,
  type MarketSetting,
  type Problem,
} from "../../../extensions/shared/settings";
import { formatUserErrors, messageOf, type Gql, type UserError } from "./gql";
import { SAVE_SETTING } from "./settings";

export { SETTINGS_KEY, SETTINGS_NAMESPACE };

// ---------------------------------------------------------------- tabs

export type TabId = "translation" | "quality" | "groups" | "thresholds" | "themeFields" | "helpers" | "records" | "links" | "markets" | "sale" | "collections" | "activity" | "adaptations";

export const SETTINGS_TABS: { id: TabId; label: string; about: string }[] = [
  { id: "translation", label: "Translation status", about: "Which rows the block shows, in which order, and for which languages." },
  { id: "groups", label: "Groups and profiles", about: "Which groups of checks run, for which kind of product. Single checks sit in the Advanced fold. Used by Product health and Data quality." },
  { id: "thresholds", label: "Thresholds", about: "SEO lengths, minimum images, alt text target, score weights and the main market." },
  { id: "themeFields", label: "Theme fields", about: "The metafields your storefront theme reads, and what each must look like." },
  { id: "helpers", label: "Helper products", about: "Which Types, tags and title patterns mean Option product or Bundle, and the Types a product should have." },
  { id: "records", label: "Linked records", about: "The swatch, delivery-time and design records, and the variant metafields that point to them." },
  { id: "quality", label: "Data quality", about: "Length, seater and lead-time metafields, and your own “metafield must not be empty” checks." },
  { id: "links", label: "Quick links", about: "The preview theme and the storefront domain of each market." },
  { id: "markets", label: "Market availability", about: "The markets the Market availability and Sale and badge blocks list." },
  { id: "sale", label: "Sale and badge", about: "The sale collection and the badge metafield." },
  { id: "collections", label: "Collections and tags", about: "What the Collections and tags block shows." },
  { id: "activity", label: "Recent activity", about: "How many events the block lists." },
  { id: "adaptations", label: "Market adaptations", about: "Which languages can be adapted for a market. Each one adds a translation box in Edit product and Bulk edit." },
];

export const tabLabel = (id: TabId): string => SETTINGS_TABS.find((t) => t.id === id)?.label ?? id;

/** Which paths of a problem belong to which tab. */
export function problemTab(path: string): TabId {
  const head = path.split(".")[0] ?? "";
  switch (head) {
    case "languages":
    case "translation":
      return "translation";
    case "quality":
      return "quality";
    case "groups":
      return "groups";
    case "thresholds":
      return "thresholds";
    case "themeFields":
      return "themeFields";
    case "helpers":
      return "helpers";
    case "records":
      return "records";
    case "links":
      return "links";
    case "markets": {
      return path.endsWith(".domain") ? "links" : "markets";
    }
    case "sale":
      return "sale";
    case "collections":
      return "collections";
    case "activity":
      return "activity";
    default:
      return "adaptations";
  }
}

export const problemsOfTab = (problems: Problem[], tab: TabId): Problem[] => problems.filter((p) => problemTab(p.path) === tab);

// ---------------------------------------------------------------- reset to defaults (one tab)

/** Puts one tab back to the defaults. Other tabs are untouched. Where two tabs share a list (the domains of the markets), only this tab's part is reset. */
export function resetTab(s: BlockSettings, tab: TabId): BlockSettings {
  const d = defaultSettings();
  const next = structuredClone(s);
  switch (tab) {
    case "translation":
      next.languages = d.languages;
      next.translation = d.translation;
      break;
    case "quality":
      next.quality = d.quality;
      break;
    case "groups":
      next.groups = d.groups;
      break;
    case "thresholds":
      next.thresholds = d.thresholds;
      break;
    case "themeFields":
      next.themeFields = d.themeFields;
      break;
    case "helpers":
      next.helpers = d.helpers;
      break;
    case "records":
      next.records = d.records;
      break;
    case "links": {
      next.links = { ...next.links, previewThemeId: d.links.previewThemeId };
      next.markets = next.markets.map((m) => {
        const base = d.markets.find((x) => x.key === m.key);
        return base ? { ...m, domain: base.domain, stayUs: base.stayUs } : m;
      });
      break;
    }
    case "markets": {
      // The default list of markets, but the domains already chosen on the Quick links tab are kept.
      next.markets = d.markets.map((base) => {
        const now = s.markets.find((m) => m.key === base.key);
        return now ? { ...base, domain: now.domain, stayUs: now.stayUs } : base;
      });
      next.links = { ...next.links, previewMarket: d.links.previewMarket };
      break;
    }
    case "sale":
      next.sale = d.sale;
      break;
    case "collections":
      next.collections = d.collections;
      break;
    case "activity":
      next.activity = d.activity;
      break;
    case "adaptations":
      next.adaptations = d.adaptations;
      break;
  }
  return next;
}

/** True when this tab already has the default values (the reset button is then not needed). */
export const tabIsDefault = (s: BlockSettings, tab: TabId): boolean => JSON.stringify(resetTab(s, tab)) === JSON.stringify(s);

// ---------------------------------------------------------------- what changed, in words

export type SettingChange = { tab: TabId; label: string; from: string; to: string };

const EMPTY = "(empty)";
const show = (v: string): string => (v === "" ? EMPTY : v);
const onOff = (v: boolean) => (v ? "on" : "off");
const fieldText = (f: FieldRef) => `${f.namespace}.${f.key} (${f.owner})`;
const fieldsText = (list: FieldRef[]) => (list.length ? list.map(fieldText).join(", ") : "none");
const checkText = (c: CheckSetting) => `${c.on ? "on" : "off"}${c.field ? `, ${fieldText(c.field)}` : ""}`;

function marketChanges(a: MarketSetting | undefined, b: MarketSetting | undefined, key: string, out: SettingChange[]) {
  if (!a && b) {
    out.push({ tab: "markets", label: `Market ${key}`, from: "not listed", to: `added (${b.label}, ${b.country}, ${b.domain})` });
    return;
  }
  if (a && !b) {
    out.push({ tab: "markets", label: `Market ${key}`, from: `${a.label}, ${a.country}`, to: "removed" });
    return;
  }
  if (!a || !b) return;
  if (a.enabled !== b.enabled) out.push({ tab: "markets", label: `${key} shown in the blocks`, from: onOff(a.enabled), to: onOff(b.enabled) });
  if (a.label !== b.label) out.push({ tab: "markets", label: `${key} name`, from: a.label, to: b.label });
  if (a.country !== b.country) out.push({ tab: "markets", label: `${key} country`, from: a.country, to: b.country });
  if (a.locale !== b.locale) out.push({ tab: "markets", label: `${key} language`, from: show(a.locale), to: show(b.locale) });
  if (a.marketHandle !== b.marketHandle) out.push({ tab: "markets", label: `${key} market handle`, from: show(a.marketHandle), to: show(b.marketHandle) });
  if (a.domain !== b.domain) out.push({ tab: "links", label: `${key} storefront domain`, from: a.domain, to: b.domain });
  if (a.stayUs !== b.stayUs) out.push({ tab: "links", label: `${key} adds ?stay_us=1`, from: onOff(a.stayUs), to: onOff(b.stayUs) });
}

const listText = (list: string[]) => (list.length ? list.join(", ") : "none");

/** The differences in the five health sections. */
function diffHealth(before: BlockSettings, after: BlockSettings, push: (tab: TabId, label: string, from: string, to: string) => void, out: SettingChange[]) {
  for (const g of GROUPS) {
    push("groups", `${GROUP_LABEL[g]} group`, onOff(before.groups.groups[g]), onOff(after.groups.groups[g]));
    for (const p of PROFILES) push("groups", `${GROUP_LABEL[g]} for ${PROFILE_LABEL[p].toLowerCase()}`, onOff(before.groups.profiles[p][g]), onOff(after.groups.profiles[p][g]));
  }
  for (const r of RULE_CATALOGUE) push("groups", `Single check: ${r.label}`, onOff(!before.groups.disabledRules.includes(r.id)), onOff(!after.groups.disabledRules.includes(r.id)));

  const t0 = before.thresholds;
  const t1 = after.thresholds;
  push("thresholds", "SEO title, longest", String(t0.seoTitleMax), String(t1.seoTitleMax));
  push("thresholds", "SEO description, shortest", String(t0.seoDescMin), String(t1.seoDescMin));
  push("thresholds", "SEO description, longest", String(t0.seoDescMax), String(t1.seoDescMax));
  push("thresholds", "Minimum images", String(t0.minImages), String(t1.minImages));
  push("thresholds", "Alt text target (percent)", String(t0.altTarget), String(t1.altTarget));
  for (const sev of Object.keys(SEVERITY_LABEL) as (keyof typeof SEVERITY_LABEL)[]) push("thresholds", `Score weight: ${SEVERITY_LABEL[sev]}`, String(t0.weights[sev]), String(t1.weights[sev]));
  push("thresholds", "Main market", show(t0.primaryMarket), show(t1.primaryMarket));

  const themeText = (f: BlockSettings["themeFields"][number]) => `${f.on ? "on" : "off"}, ${f.namespace}.${f.key} (${f.owner}), ${THEME_RULE_LABEL[f.rule].toLowerCase()}, ${SEVERITY_LABEL[f.severity].toLowerCase()}, for ${f.profiles.map((p) => PROFILE_LABEL[p].toLowerCase()).join(" and ") || "nobody"}`;
  const ids = [...new Set([...before.themeFields.map((f) => f.id), ...after.themeFields.map((f) => f.id)])];
  for (const id of ids) {
    const a = before.themeFields.find((f) => f.id === id);
    const b = after.themeFields.find((f) => f.id === id);
    const name = b?.label ?? a?.label ?? id;
    if (!a && b) out.push({ tab: "themeFields", label: `Theme field: ${name}`, from: "not in the list", to: `added, ${themeText(b)}` });
    else if (a && !b) out.push({ tab: "themeFields", label: `Theme field: ${name}`, from: themeText(a), to: "removed" });
    else if (a && b && themeText(a) !== themeText(b)) out.push({ tab: "themeFields", label: `Theme field: ${name}`, from: themeText(a), to: themeText(b) });
    else if (a && b && a.label !== b.label) out.push({ tab: "themeFields", label: "Theme field name", from: a.label, to: b.label });
  }

  const h0 = before.helpers;
  const h1 = after.helpers;
  push("helpers", "Option product Types", listText(h0.types), listText(h1.types));
  push("helpers", "Option product tags", listText(h0.tags), listText(h1.tags));
  push("helpers", "Option product title patterns", listText(h0.titlePatterns), listText(h1.titlePatterns));
  push("helpers", "Bundle Types", listText(h0.bundleTypes), listText(h1.bundleTypes));
  push("helpers", "Bundle tags", listText(h0.bundleTags), listText(h1.bundleTags));
  push("helpers", "Expected product Types", listText(h0.expectedCategories), listText(h1.expectedCategories));
  push("helpers", "Wood and material names", listText(h0.woodNames), listText(h1.woodNames));

  const r0 = before.records;
  const r1 = after.records;
  push("records", "Swatch record type", show(r0.swatchType), show(r1.swatchType));
  push("records", "Delivery-time record type", show(r0.deliveryType), show(r1.deliveryType));
  push("records", "Design record type", show(r0.designType), show(r1.designType));
  push("records", "Swatch variant metafield", fieldText(r0.swatchField), fieldText(r1.swatchField));
  push("records", "Hide-from-markets variant metafield", fieldText(r0.hideField), fieldText(r1.hideField));
}

/** Every difference between two settings, one line each, for the review. Empty = nothing to save. */
export function diffSettings(before: BlockSettings, after: BlockSettings): SettingChange[] {
  const out: SettingChange[] = [];
  const push = (tab: TabId, label: string, from: string, to: string) => {
    if (from !== to) out.push({ tab, label, from, to });
  };

  push("translation", "Languages", before.languages.map((l) => `${l.label} (${l.code})`).join(", "), after.languages.map((l) => `${l.label} (${l.code})`).join(", "));
  push("translation", "Rows, in order", before.translation.rows.map(rowLabel).join(", "), after.translation.rows.map(rowLabel).join(", "));

  const ids = [...new Set([...before.quality.checks.map((c) => c.id), ...after.quality.checks.map((c) => c.id)])];
  for (const id of ids) {
    const a = before.quality.checks.find((c) => c.id === id);
    const b = after.quality.checks.find((c) => c.id === id);
    const name = b?.label ?? a?.label ?? id;
    if (!a && b) out.push({ tab: "quality", label: `Check: ${name}`, from: "not in the list", to: `added, ${checkText(b)}` });
    else if (a && !b) out.push({ tab: "quality", label: `Check: ${name}`, from: checkText(a), to: "removed" });
    else if (a && b) {
      if (a.on !== b.on) out.push({ tab: "quality", label: `Check: ${name}`, from: onOff(a.on), to: onOff(b.on) });
      if (a.label !== b.label) out.push({ tab: "quality", label: `Check name`, from: a.label, to: b.label });
      if (a.field && b.field && fieldText(a.field) !== fieldText(b.field)) out.push({ tab: "quality", label: `Check: ${name}, metafield`, from: fieldText(a.field), to: fieldText(b.field) });
    }
  }
  if (JSON.stringify(before.quality.checks.map((c) => c.id)) !== JSON.stringify(after.quality.checks.map((c) => c.id)) && ids.length === before.quality.checks.length && ids.length === after.quality.checks.length) {
    out.push({ tab: "quality", label: "Order of the checks", from: before.quality.checks.map((c) => c.label).join(", "), to: after.quality.checks.map((c) => c.label).join(", ") });
  }
  push("quality", "Length metafields", fieldsText(before.quality.fields.length), fieldsText(after.quality.fields.length));
  push("quality", "Seater metafields", fieldsText(before.quality.fields.seater), fieldsText(after.quality.fields.seater));
  push("quality", "Lead-time metafields", fieldsText(before.quality.fields.leadTime), fieldsText(after.quality.fields.leadTime));

  diffHealth(before, after, push, out);

  push("links", "Preview theme id", show(before.links.previewThemeId), show(after.links.previewThemeId));
  push("markets", "Market used for the preview link", show(before.links.previewMarket), show(after.links.previewMarket));

  const keys = [...new Set([...before.markets.map((m) => m.key), ...after.markets.map((m) => m.key)])];
  for (const key of keys) marketChanges(before.markets.find((m) => m.key === key), after.markets.find((m) => m.key === key), key, out);
  const order = (s: BlockSettings) => s.markets.map((m) => m.key).join(", ");
  if (order(before) !== order(after) && keys.length === before.markets.length && keys.length === after.markets.length) push("markets", "Order of the markets", order(before), order(after));

  push("sale", "Badge metafield", `${before.sale.badgeNamespace}.${before.sale.badgeKey}`, `${after.sale.badgeNamespace}.${after.sale.badgeKey}`);
  push("sale", "Sale collection handle", show(before.sale.collectionHandle), show(after.sale.collectionHandle));

  push("collections", "Show tags", onOff(before.collections.showTags), onOff(after.collections.showTags));
  push("collections", "Show collection type", onOff(before.collections.showType), onOff(after.collections.showType));

  push("activity", "Events listed", String(before.activity.eventsLimit), String(after.activity.eventsLimit));

  const adapt = (s: BlockSettings) => new Map(s.adaptations.map((a) => [`${a.locale}|${a.marketId}`, `${a.locale} for ${a.marketName}`]));
  const a0 = adapt(before);
  const a1 = adapt(after);
  for (const [k, v] of a1) if (!a0.has(k)) out.push({ tab: "adaptations", label: "Adaptation", from: "not available", to: `${v} added` });
  for (const [k, v] of a0) if (!a1.has(k)) out.push({ tab: "adaptations", label: "Adaptation", from: v, to: "removed (texts already saved in Shopify stay)" });

  return out;
}

export { CHECK_CATALOGUE, CORE_FIELD_LABEL };

// ---------------------------------------------------------------- reading what is stored

export const BLOCK_READ = `#graphql
  query BlockSettingsRead {
    currentAppInstallation {
      id
      blocks: metafield(namespace: "${SETTINGS_NAMESPACE}", key: "${SETTINGS_KEY}") { value }
    }
  }`;

export type StoredBlocks = { installationId: string; raw: string | null };

export async function readStoredBlocks(gql: Gql): Promise<StoredBlocks> {
  const d = await gql<{ currentAppInstallation: { id: string; blocks: { value: string } | null } }>(BLOCK_READ);
  return { installationId: d.currentAppInstallation.id, raw: d.currentAppInstallation.blocks?.value ?? null };
}

// ---------------------------------------------------------------- the guarded save

export type SaveResult = { raw: string };

/**
 * Saves the settings. Call it inside the password guard. Order: check that the stored value is still the one the page
 * was opened with (nobody else saved), write it, read it back and compare. Throws a plain message on any problem.
 */
export async function saveBlockSettings(gql: Gql, input: { installationId: string; expectedRaw: string | null; next: BlockSettings }): Promise<SaveResult> {
  const found = problemsOf(input.next);
  if (found.length) throw new Error(`Nothing was saved. ${found[0]!.message}`);

  const now = await readStoredBlocks(gql);
  if ((now.raw ?? null) !== (input.expectedRaw ?? null)) {
    throw new Error("Someone saved these settings since you opened the page. Nothing was saved. Reload the page and make your changes again.");
  }

  const raw = serializeSettings(input.next);
  const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(SAVE_SETTING, {
    metafields: [{ ownerId: input.installationId, namespace: SETTINGS_NAMESPACE, key: SETTINGS_KEY, type: "json", value: raw }],
  });
  const message = formatUserErrors(data.metafieldsSet.userErrors);
  if (message) throw new Error(`Shopify did not save the settings: ${message}`);

  let back: StoredBlocks;
  try {
    back = await readStoredBlocks(gql);
  } catch (e) {
    throw new Error(`The settings were sent, but reading them back failed (${messageOf(e)}). Reload the page to check.`);
  }
  const stored = parseSettings(back.raw);
  if (stored.source !== "saved" || JSON.stringify(stored.settings) !== JSON.stringify(parseSettings(raw).settings)) {
    throw new Error("Shopify answered, but the saved settings do not match what was sent. Reload the page to see what is stored.");
  }
  return { raw: back.raw ?? raw };
}
