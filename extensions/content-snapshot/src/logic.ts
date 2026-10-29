// Content snapshot: numbers only, no pass or fail. A number is marked when it is out of range for the settings.

import { fieldAlias, isBlank, loadFacts, parseTokens, textOf, type ProductFacts } from "../../shared/facts";
import type { LoadContext } from "../../shared/query";
import { settingsOf, type BlockSettings, type FieldRef } from "../../shared/settings";

export type Fact = { key: string; label: string; value: string; /** For the bar: current and the limit it is compared with. */ bar?: { now: number; max: number }; warn: boolean; note?: string };
export type Data = { facts: Fact[]; notes: string[]; read: { content: boolean; media: boolean } };

const field = (key: string, label: string, namespace = "custom"): FieldRef => ({ label, namespace, key, owner: "product" });
const TAG_LINE = field("tag_line", "Tag line");
const WOOD = field("product_wood_type", "Wood type");
const MATERIAL = field("material-main-title", "Material title");
const RELATED = field("hd_related_products", "Related products");
const RECOMMENDED = field("hd_recommended_products", "Recommended products");

/** The first theme field of the settings that looks like a dimensions field (none is assumed). */
export const dimensionsField = (s: BlockSettings): FieldRef | null => {
  const f = s.themeFields.find((x) => x.owner === "product" && /dimension/i.test(`${x.key} ${x.label}`));
  return f ? { label: f.label, namespace: f.namespace, key: f.key, owner: "product" } : null;
};

export const needFields = (s: BlockSettings): FieldRef[] => [TAG_LINE, WOOD, MATERIAL, RELATED, RECOMMENDED, ...(dimensionsField(s) ? [dimensionsField(s)!] : [])];

const present = (f: ProductFacts, x: FieldRef) => !isBlank(f.fields[fieldAlias(x)]);
const count = (f: ProductFacts, x: FieldRef) => parseTokens(f.fields[fieldAlias(x)]?.value).length;

export function snapshot(f: ProductFacts, s: BlockSettings): Data {
  const t = s.thresholds;
  const out: Fact[] = [];
  const titleLen = f.title.trim().length;
  out.push({ key: "title", label: "Title", value: `${titleLen} characters`, warn: titleLen === 0 });
  if (f.read.content === "ok") {
    const seoT = f.seoTitle.trim().length;
    const seoD = f.seoDescription.trim().length;
    out.push({ key: "seoTitle", label: "SEO title", value: `${seoT} / ${t.seoTitleMax}`, bar: { now: seoT, max: t.seoTitleMax }, warn: seoT === 0 || seoT > t.seoTitleMax });
    out.push({ key: "seoDesc", label: "SEO description", value: `${seoD} / ${t.seoDescMax}`, bar: { now: seoD, max: t.seoDescMax }, warn: seoD === 0 || seoD < t.seoDescMin || seoD > t.seoDescMax, note: seoD > 0 && seoD < t.seoDescMin ? `Under ${t.seoDescMin}` : undefined });
    out.push({ key: "body", label: "Description", value: `${f.bodyWords} words`, warn: f.bodyWords === 0 });
  }
  if (f.read.media === "ok") {
    const withAlt = f.images.filter((m) => m.alt.trim()).length;
    const pct = f.images.length ? Math.round((withAlt / f.images.length) * 100) : 100;
    out.push({ key: "images", label: "Images", value: `${f.images.length}`, warn: f.images.length < t.minImages });
    out.push({ key: "alt", label: "Alt text", value: f.images.length ? `${withAlt} of ${f.images.length} (${pct}%)` : "—", warn: f.images.length > 0 && pct < t.altTarget });
  }
  out.push({ key: "tagLine", label: "Tag line", value: present(f, TAG_LINE) ? "Yes" : "No", warn: !present(f, TAG_LINE) });
  out.push({ key: "wood", label: "Wood type", value: textOf(f.fields[fieldAlias(WOOD)]).trim() || "—", warn: isBlank(f.fields[fieldAlias(WOOD)]) });
  out.push({ key: "material", label: "Material title", value: textOf(f.fields[fieldAlias(MATERIAL)]).trim() || "—", warn: isBlank(f.fields[fieldAlias(MATERIAL)]) });
  out.push({ key: "related", label: "Related products", value: `${count(f, RELATED)}`, warn: false });
  out.push({ key: "recommended", label: "Recommended products", value: `${count(f, RECOMMENDED)}`, warn: false });
  const dims = dimensionsField(s);
  if (dims) out.push({ key: "dimensions", label: dims.label, value: present(f, dims) ? "Yes" : "No", warn: !present(f, dims) });
  return { facts: out, notes: f.notes, read: { content: f.read.content === "ok", media: f.read.media === "ok" } };
}

export async function load(ctx: LoadContext): Promise<Data> {
  const settings = settingsOf(ctx);
  const facts = await loadFacts(ctx, { content: true, media: true, fields: needFields(settings) });
  return snapshot(facts, settings);
}
