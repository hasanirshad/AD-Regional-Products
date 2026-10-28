// "Preview how the block will look": the real block code run on sample data. The Settings page shows the result in
// plain React. The sample product is made up (it is not read from the store); only the settings are real.

import { fieldAlias, evaluate, neededFields } from "../../../extensions/data-quality/src/logic";
import { buildLinks } from "../../../extensions/quick-links/src/logic";
import { shape as shapeTranslations } from "../../../extensions/translation-status/src/logic";
import { marketDefs, type BlockSettings } from "../../../extensions/shared/settings";
import type { Cell } from "../../../extensions/shared/translationCells";
import type { Slot } from "./locales";

export type Tone = "success" | "warning" | "critical" | "neutral" | "info" | "caution";
export type PreviewCell = { text: string; tone?: Tone };
export type PreviewTable = { title?: string; headers: string[]; rows: PreviewCell[][] };
export type Preview = {
  /** What the collapsed block shows. */
  summary: string;
  pills: PreviewCell[];
  notes: string[];
  tables: PreviewTable[];
  links: { label: string; url: string }[];
  /** When nothing would be shown. */
  empty: string | null;
};

const EMPTY: Preview = { summary: "", pills: [], notes: [], tables: [], links: [], empty: null };

const CELL_TEXT: Record<Cell["status"], PreviewCell> = {
  translated: { text: "Translated", tone: "success" },
  missing: { text: "Missing", tone: "critical" },
  same: { text: "Same as source", tone: "caution" },
  none: { text: "—" },
};
const cellOf = (c: Cell): PreviewCell => {
  const base = CELL_TEXT[c.status];
  const counts = c.counts && c.counts.total > 1 && c.status !== "none" ? ` ${c.counts[c.status]}/${c.counts.total}` : "";
  return { ...base, text: `${base.text}${counts}` };
};

/** translated, missing, same: so every state shows in the sample. */
const STATES = ["translated", "missing", "same"] as const;
const stateFor = (language: number, row: number) => STATES[(language + row) % 3]!;

type Known = { namespace: string; key: string }[];

function translationPreview(s: BlockSettings, known: Known): Preview {
  const codes = s.languages.map((l) => l.code);
  const content = (key: string, value: string) => [{ key, value }];
  const trans = (key: string, value: string, row: number) =>
    Object.fromEntries(
      codes.map((code, li) => {
        const st = stateFor(li, row);
        return [`tr_${code.replace(/[^A-Za-z0-9]/g, "_")}`, st === "missing" ? [] : [{ key, value: st === "same" ? value : `${value} (${code})`, outdated: false }]];
      }),
    );

  let n = 0;
  const product: Record<string, unknown> = { id: "sample", options: [{ id: "opt", name: "Size", optionValues: [{ id: "v1", name: "Small" }, { id: "v2", name: "Large" }] }] };
  const productContent = ["title", "body_html", "meta_title", "meta_description", "handle"].map((key) => ({ key, value: `Sample ${key}` }));
  const productTranslations: Record<string, unknown> = {};
  for (const [li, code] of codes.entries()) {
    productTranslations[`tr_${code.replace(/[^A-Za-z0-9]/g, "_")}`] = productContent.flatMap((c, ci) => {
      const st = stateFor(li, ci);
      return st === "missing" ? [] : [{ key: c.key, value: st === "same" ? c.value : `${c.value} (${code})` }];
    });
  }

  const nested: Record<string, unknown>[] = [];
  const addNested = (id: string, key: string) => {
    nested.push({ resourceId: id, translatableContent: content(key, "Sample text"), ...trans(key, "Sample text", n++) });
  };
  addNested("opt", "name");
  addNested("v1", "name");
  addNested("v2", "name");

  let ns = 0;
  let mf = 0;
  for (const r of s.translation.rows) {
    if (r.type === "namespace") {
      const list = known.filter((k) => k.namespace === r.namespace).slice(0, 3);
      const picked = list.length ? list : [{ namespace: r.namespace, key: "sample_1" }, { namespace: r.namespace, key: "sample_2" }];
      product[`ns${ns++}`] = { nodes: picked.map((k) => ({ id: `ns-${k.key}`, namespace: k.namespace, key: k.key })) };
      for (const k of picked) addNested(`ns-${k.key}`, "value");
    }
    if (r.type === "metafield") {
      product[`mf${mf}`] = { id: `mf-${r.key}`, namespace: r.namespace, key: r.key };
      addNested(`mf-${r.key}`, "value");
      mf++;
    }
  }

  const data = shapeTranslations({ product: product as never, translatableResource: { translatableContent: productContent, ...productTranslations } as never }, nested as never, s);
  if (data.rows.length === 0) return { ...EMPTY, empty: "Nothing to translate yet." };
  const gaps = Object.values(data.totals).reduce((sum, t) => sum + t.missing + t.same, 0);
  return {
    ...EMPTY,
    summary: gaps ? `${gaps} to fix` : "All translated",
    pills: data.languages.map((l) => {
      const t = data.totals[l.code]!;
      return { text: `${l.label}: ${t.translated} of ${t.total}`, tone: t.missing + t.same ? "warning" : "success" };
    }),
    tables: [{ headers: ["Field", ...data.languages.map((l) => l.code.toUpperCase())], rows: data.rows.map((r) => [{ text: r.label }, ...data.languages.map((l) => cellOf(r.cells[l.code]!))]) }],
    notes: ['"Same as source" means the translation is identical to the original, so it was probably never translated.', ...data.notes],
  };
}

function qualityPreview(s: BlockSettings): Preview {
  const fields = neededFields(s);
  const filled: Record<string, unknown> = {};
  const lead = new Set(s.quality.fields.leadTime.map(fieldAlias));
  for (const f of fields) filled[fieldAlias(f)] = lead.has(fieldAlias(f)) ? null : { value: "Sample" };
  const variant = (id: string) => ({ id, title: `Variant ${id}`, price: "100.00", selectedOptions: [], ...filled });
  const d = evaluate(
    {
      id: "sample",
      status: "ACTIVE",
      seo: { title: "Sample title", description: "Sample description" },
      media: { nodes: [{ alt: "Front view", mediaContentType: "IMAGE" }, { alt: "", mediaContentType: "IMAGE" }], pageInfo: { hasNextPage: false } },
      resourcePublicationsV2: { nodes: [{ publication: { id: "p" } }] },
      variants: { nodes: [variant("1"), variant("2")], pageInfo: { hasNextPage: false } },
      ...filled,
    } as never,
    [variant("1"), variant("2")] as never,
    [],
    s,
  );
  if (d.checks.length === 0) return { ...EMPTY, summary: "No checks", empty: "No checks are switched on." };
  const tone = { pass: "success", fail: "critical", skipped: "neutral" } as const;
  const word = { pass: "Pass", fail: "Fail", skipped: "Not configured" } as const;
  return {
    ...EMPTY,
    summary: `${d.passed} of ${d.counted} passed`,
    pills: [{ text: `${d.passed} of ${d.counted} passed`, tone: d.passed === d.counted ? "success" : "warning" }],
    tables: [{ headers: ["Check", "Result", "Why"], rows: d.checks.map((c) => [{ text: c.label }, { text: word[c.status], tone: tone[c.status] }, { text: c.reason || "—" }]) }],
  };
}

function linksPreview(s: BlockSettings): Preview {
  const defs = marketDefs(s);
  const d = buildLinks({ handle: "oak-table", status: "ACTIVE", shop: "your-store", productId: "gid://shopify/Product/1", themeId: s.links.previewThemeId, markets: defs, previewKey: s.links.previewMarket });
  return {
    ...EMPTY,
    summary: `${d.storefront.length} storefront links`,
    links: [...d.storefront.map((l) => ({ label: `${l.key} · ${l.label}`, url: l.url })), ...(d.preview ? [{ label: d.preview.label, url: d.preview.url }] : [])],
    notes: d.preview ? [] : ["No preview theme set, so the preview link is hidden."],
  };
}

function marketsPreview(s: BlockSettings): Preview {
  const defs = marketDefs(s);
  if (defs.length === 0) return { ...EMPTY, summary: "No markets", empty: "No market is switched on." };
  const rows = defs.map((m, i) => ({ m, published: i !== 1 }));
  const missing = rows.filter((r) => !r.published).map((r) => r.m.key);
  return {
    ...EMPTY,
    summary: `${rows.filter((r) => r.published).length} of ${defs.length} market${defs.length === 1 ? "" : "s"}`,
    notes: missing.length ? [`Not published in ${missing.join(", ")}. These markets do not show this product.`] : [],
    tables: [{ headers: ["Market", "Status", "Price", "Compare-at"], rows: rows.map((r) => [{ text: r.m.key }, r.published ? { text: "Published", tone: "success" } : { text: "Not published", tone: "critical" }, { text: "Sample price" }, { text: "—" }]) }],
  };
}

function salePreview(s: BlockSettings): Preview {
  const defs = marketDefs(s);
  const handle = s.sale.collectionHandle;
  return {
    ...EMPTY,
    summary: defs.length ? `On sale in ${defs.length} market${defs.length === 1 ? "" : "s"}` : "No sale",
    tables: [
      { headers: ["Market", "Price", "Compare-at", "Discount"], rows: defs.map((m) => [{ text: m.key }, { text: "Sample price" }, { text: "Sample price" }, { text: "20% off", tone: "success" }]) },
      { title: `Badge (${s.sale.badgeNamespace}.${s.sale.badgeKey})`, headers: ["Language", "Translation"], rows: s.languages.map((l, i) => [{ text: l.label }, cellOf({ status: STATES[i % 3]!, outdated: false, counts: null })]) },
    ],
    pills: handle ? [{ text: `In "${handle}"`, tone: "success" }] : [],
    notes: handle ? [] : ["No sale collection is set, so the block skips that check."],
  };
}

function collectionsPreview(s: BlockSettings): Preview {
  const { showTags, showType } = s.collections;
  return {
    ...EMPTY,
    summary: showTags ? "2 collections, 2 tags" : "2 collections",
    tables: [
      {
        title: "Collections (2)",
        headers: showType ? ["Collection", "Type"] : ["Collection"],
        rows: [
          showType ? [{ text: "Best sellers" }, { text: "Manual", tone: "neutral" }] : [{ text: "Best sellers" }],
          showType ? [{ text: "Tables" }, { text: "Automated", tone: "info" }] : [{ text: "Tables" }],
        ],
      },
    ],
    pills: showTags ? [{ text: "new_stock", tone: "neutral" }, { text: "b2b", tone: "neutral" }] : [],
    notes: showTags ? [] : ["Tags are hidden."],
  };
}

function activityPreview(s: BlockSettings): Preview {
  const n = Number.isInteger(s.activity.eventsLimit) ? Math.max(0, Math.min(s.activity.eventsLimit, 50)) : 0;
  const shown = Math.min(n, 6);
  const sample = ["Product was published.", "SEO title was changed.", "Inventory was updated.", "Product was created.", "Tags were changed.", "Description was changed."];
  const who = ["App: AD Metafields", "A staff member", "Shopify"];
  return {
    ...EMPTY,
    summary: "Updated today",
    tables: [{ headers: ["When", "What happened", "Who"], rows: Array.from({ length: shown }, (_, i) => [{ text: `${i + 1} day${i === 0 ? "" : "s"} ago` }, { text: sample[i % sample.length]! }, { text: who[i % who.length]! }]) }],
    notes: [n > shown ? `The block lists up to ${n} events; this preview shows ${shown}.` : `The block lists up to ${n} event${n === 1 ? "" : "s"}.`],
  };
}

function adaptationsPreview(s: BlockSettings, slots: Slot[]): Preview {
  const adapted = s.adaptations.map((a) => ({ a, slot: slots.find((x) => x.marketId === a.marketId && x.locale === a.locale) }));
  if (adapted.length === 0) return { ...EMPTY, empty: "No adaptation is set, so Edit product shows one box for each store language only." };
  return {
    ...EMPTY,
    summary: `${adapted.length} adaptation${adapted.length === 1 ? "" : "s"}`,
    notes: ["Each adaptation adds one translation box next to the language boxes, for every translatable field in Edit product and one column choice in Bulk edit."],
    tables: [{ title: "Title", headers: ["Box", "Where it applies"], rows: [[{ text: "French" }, { text: "Every market" }], ...adapted.map(({ a, slot }) => [{ text: slot?.label ?? `${a.locale} · ${a.marketName}` }, { text: `${a.marketName} only` }])] }],
  };
}

/** The preview of one tab. `known` are the store's product metafield definitions (used for "all metafields in a namespace"); `slots` the labels of the adapted languages. */
export function previewOf(tab: string, s: BlockSettings, extra: { known?: Known; slots?: Slot[] } = {}): Preview {
  switch (tab) {
    case "translation":
      return translationPreview(s, extra.known ?? []);
    case "quality":
      return qualityPreview(s);
    case "links":
      return linksPreview(s);
    case "markets":
      return marketsPreview(s);
    case "sale":
      return salePreview(s);
    case "collections":
      return collectionsPreview(s);
    case "activity":
      return activityPreview(s);
    default:
      return adaptationsPreview(s, extra.slots ?? []);
  }
}
