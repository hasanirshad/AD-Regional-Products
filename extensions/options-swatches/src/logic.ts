// Options and swatches: each option value with its swatch record, and what is wrong with it.
// Nothing here is verified on the real store: which metafield points to the swatch, and the field names of the
// swatch records (group, group_key, group_priority), come from the store export. See "Not verified" in the docs.

import { fieldAlias, loadFacts, parseTokens, type ProductFacts } from "../../shared/facts";
import { plural } from "../../shared/format";
import { loadRecords, looksLikeTest, EMPTY_RECORDS, type MetaobjectFact, type RecordsFacts } from "../../shared/records";
import type { LoadContext } from "../../shared/query";
import { settingsOf, type BlockSettings, type MarketSetting } from "../../shared/settings";

export type SwatchInfo = { id: string; name: string; status: "ACTIVE" | "DRAFT" | null; group: string; groupKey: string; priority: string; hasModel: boolean; href: string };
export type ValueRow = { option: string; value: string; variants: number; swatches: SwatchInfo[]; flags: string[] };
export type VariantIssue = { id: string; title: string; issues: string[] };
export type Data = {
  values: ValueRow[];
  /** Markets where every variant carries the hide-from-markets value. */
  hiddenMarkets: string[];
  variantIssues: VariantIssue[];
  /** null = the swatch records were not read. */
  recordsRead: boolean;
  variantExtras: boolean;
  variantCount: number;
  notes: string[];
  swatchType: string;
};

const MODEL_KEY = /3d|model|glb|usdz/i;

const entryHref = (o: MetaobjectFact) => `shopify:admin/content/metaobjects/entries/${o.type}/${o.id.split("/").pop()}`;

export function swatchInfo(o: MetaobjectFact): SwatchInfo {
  const modelKey = Object.keys(o.fields).find((k) => MODEL_KEY.test(k));
  return {
    id: o.id,
    name: o.displayName || o.handle,
    status: o.status,
    group: (o.fields.group ?? "").trim(),
    groupKey: (o.fields.group_key ?? "").trim(),
    priority: (o.fields.group_priority ?? "").trim(),
    hasModel: !!modelKey && !!(o.fields[modelKey] ?? "").trim(),
    href: entryHref(o),
  };
}

/** Words that name a market, so a hide-from-markets value like "UK, fr" can be matched. */
const marketWords = (m: Pick<MarketSetting, "key" | "label" | "country" | "marketHandle">) => [m.key, m.label, m.country, m.marketHandle].map((x) => x.trim().toLowerCase()).filter(Boolean);

export function hiddenEverywhere(facts: ProductFacts, s: BlockSettings): string[] {
  if (facts.variants.length === 0) return [];
  const a = fieldAlias(s.records.hideField);
  const lists = facts.variants.map((v) => new Set(parseTokens(v.fields[a]?.value).flatMap((t) => t.toLowerCase().split(/[\s,;|]+/)).filter(Boolean)));
  return s.markets.filter((m) => m.enabled).filter((m) => lists.every((set) => marketWords(m).some((w) => set.has(w)))).map((m) => m.key);
}

export function analyse(facts: ProductFacts, records: RecordsFacts, s: BlockSettings): Data {
  const swatchAlias = fieldAlias(s.records.swatchField);
  const recordsRead = records.state === "ok";
  const swatchesOf = (variantIds: Set<string>): SwatchInfo[] => {
    const ids = new Set<string>();
    for (const v of facts.variants) if (variantIds.has(v.id)) for (const t of parseTokens(v.fields[swatchAlias]?.value)) ids.add(t);
    return [...ids].map((id) => records.linked[id]).filter((o): o is MetaobjectFact => !!o && (s.records.swatchType === "" || o.type === s.records.swatchType)).map(swatchInfo);
  };

  const values: ValueRow[] = [];
  for (const o of facts.options) {
    const rows: ValueRow[] = [];
    const seen = new Set<string>();
    for (const raw of o.values) {
      const value = raw.trim();
      const key = value.toLowerCase().replace(/\s+/g, " ");
      const ids = new Set(facts.variants.filter((v) => v.selectedOptions.some((x) => x.name === o.name && x.value.trim().toLowerCase().replace(/\s+/g, " ") === key)).map((v) => v.id));
      const swatches = recordsRead ? swatchesOf(ids) : [];
      const flags: string[] = [];
      if (seen.has(key)) flags.push("Listed twice");
      seen.add(key);
      if (raw !== value) flags.push("Extra space");
      for (const sw of swatches) {
        if (sw.status === "DRAFT") flags.push(`Draft swatch: ${sw.name}`);
        if (looksLikeTest(sw.group) || looksLikeTest(sw.name)) flags.push(`Test-looking name: ${sw.name}`);
        if (!sw.group) flags.push("No group");
        if (!sw.groupKey) flags.push("No group key");
      }
      rows.push({ option: o.name, value: raw, variants: ids.size, swatches, flags: [...new Set(flags)] });
    }
    // A value without a swatch is only a problem in an option where other values have one.
    if (recordsRead && rows.some((r) => r.swatches.length > 0)) for (const r of rows) if (r.swatches.length === 0) r.flags.push("No swatch");
    values.push(...rows);
  }

  const variantIssues: VariantIssue[] = facts.variants
    .map((v) => ({
      id: v.id,
      title: v.title,
      issues: [...(facts.read.variantExtras === "ok" && !((v.weight ?? 0) > 0) ? ["Weight is 0"] : []), ...(facts.read.variantExtras === "ok" && !(v.sku ?? "").trim() ? ["No SKU"] : [])],
    }))
    .filter((v) => v.issues.length > 0);

  const notes = [...facts.notes];
  if (s.records.swatchType && !recordsRead) notes.push(records.state === "failed" ? `Swatch records could not be read (${records.message}). They need the metaobject permission.` : "Swatch records were not read.");
  return { values, hiddenMarkets: hiddenEverywhere(facts, s), variantIssues, recordsRead, variantExtras: facts.read.variantExtras === "ok", variantCount: facts.variants.length, notes, swatchType: s.records.swatchType };
}

export async function load(ctx: LoadContext): Promise<Data> {
  const settings = settingsOf(ctx);
  const facts = await loadFacts(ctx, { options: true, variants: true, fields: [settings.records.swatchField, settings.records.hideField] });
  const records = settings.records.swatchType ? await loadRecords(ctx, facts, settings, { linked: true, delivery: false }) : EMPTY_RECORDS;
  return analyse(facts, records, settings);
}

export const issueSummary = (d: Data): string => {
  const n = d.values.filter((v) => v.flags.length > 0).length + d.hiddenMarkets.length;
  return n ? plural(n, "issue") : d.values.length ? `${plural(d.values.length, "value")}` : "No options";
};
