import { aliasOf, gqlString, localeLiteral } from "../../shared/pure";
import type { LoadContext, Query } from "../../shared/query";
import { CORE_FIELD_LABEL, defaultSettings, settingsOf, type BlockSettings, type Language, type TranslationRow } from "../../shared/settings";
import { cellFor, groupCell, NO_CELL, type Cell, type Content, type Translations } from "../../shared/translationCells";

export type FieldRow = { key: string; label: string; group: "product" | "metafield" | "option"; cells: Record<string, Cell> };
export type Totals = { translated: number; missing: number; same: number; total: number };
export type Data = { languages: Language[]; rows: FieldRow[]; totals: Record<string, Totals>; notes: string[] };

type Resource = { resourceId?: string; translatableContent?: Content } & Record<string, unknown>;
type MetafieldRef = { id: string; namespace: string; key: string };

const alias = (code: string) => `tr_${aliasOf(code)}`;
const localeFields = (languages: Language[]) => languages.map((l) => `${alias(l.code)}: translations(locale: ${localeLiteral(l.code)}) { key value outdated }`).join("\n    ");

/** The metafield rows, numbered the way the query names them: ns0, ns1 for namespaces; mf0, mf1 for single metafields. */
function metafieldRows(rows: TranslationRow[]) {
  const namespaces = rows.filter((r): r is Extract<TranslationRow, { type: "namespace" }> => r.type === "namespace");
  const singles = rows.filter((r): r is Extract<TranslationRow, { type: "metafield" }> => r.type === "metafield");
  return { namespaces, singles };
}

const BASE = (s: BlockSettings) => {
  const { namespaces, singles } = metafieldRows(s.translation.rows);
  return `query TranslationBase($id: ID!) {
  product(id: $id) {
    id
    options { id name optionValues { id name } }
    ${namespaces.map((r, i) => `ns${i}: metafields(first: 50, namespace: ${gqlString(r.namespace)}) { nodes { id namespace key } }`).join("\n    ")}
    ${singles.map((r, i) => `mf${i}: metafield(namespace: ${gqlString(r.namespace)}, key: ${gqlString(r.key)}) { id namespace key }`).join("\n    ")}
  }
  translatableResource(resourceId: $id) {
    translatableContent { key value }
    ${localeFields(s.languages)}
  }
}`;
};

const NESTED = (languages: Language[]) => `query TranslationNested($ids: [ID!]!) {
  translatableResourcesByIds(first: 50, resourceIds: $ids) {
    nodes {
      resourceId
      translatableContent { key value }
      ${localeFields(languages)}
    }
  }
}`;

const translationsOf = (r: Resource, code: string): Translations => (r[alias(code)] as Translations | undefined) ?? [];

type BaseRaw = {
  product: ({ id: string; options: { id: string; name: string; optionValues: { id: string; name: string }[] }[] } & Record<string, unknown>) | null;
  translatableResource: ({ translatableContent: Content } & Record<string, unknown>) | null;
};
type NestedRaw = { translatableResourcesByIds: { nodes: Resource[] } };

async function loadNested(q: Query, ids: string[], languages: Language[]): Promise<Resource[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const parts = await Promise.all(chunks.map((c) => q<NestedRaw>(NESTED(languages), { ids: c })));
  return parts.flatMap((p) => p.translatableResourcesByIds.nodes);
}

const nodesOf = (base: BaseRaw, name: string): MetafieldRef[] => (base.product?.[name] as { nodes: MetafieldRef[] } | undefined)?.nodes ?? [];
const oneOf = (base: BaseRaw, name: string): MetafieldRef | null => (base.product?.[name] as MetafieldRef | null | undefined) ?? null;

/** The ids of everything whose translations are asked for in the second request. */
export function nestedIds(base: BaseRaw, s: BlockSettings): string[] {
  const rows = s.translation.rows;
  const ids: string[] = [];
  if (rows.some((r) => r.type === "optionNames" || r.type === "optionValues")) {
    for (const o of base.product?.options ?? []) ids.push(o.id, ...o.optionValues.map((v) => v.id));
  }
  let ns = 0;
  let mf = 0;
  for (const r of rows) {
    if (r.type === "namespace") ids.push(...nodesOf(base, `ns${ns++}`).map((m) => m.id));
    if (r.type === "metafield") {
      const m = oneOf(base, `mf${mf++}`);
      if (m) ids.push(m.id);
    }
  }
  return [...new Set(ids)];
}

export function shape(base: BaseRaw, nested: Resource[], settings: BlockSettings = defaultSettings()): Data {
  const notes: string[] = [];
  const byId = new Map(nested.map((r) => [r.resourceId ?? "", r]));
  const rows: FieldRow[] = [];
  const languages = settings.languages;
  const codes = languages.map((l) => l.code);
  const product = base.translatableResource;

  const row = (key: string, label: string, group: FieldRow["group"], cellFor_: (code: string) => Cell) => {
    const cells = Object.fromEntries(codes.map((c) => [c, cellFor_(c)]));
    if (Object.values(cells).every((c) => c.status === "none")) return;
    if (rows.some((r) => r.key === key)) return;
    rows.push({ key, label, group, cells });
  };
  const metafieldRow = (m: MetafieldRef) => {
    const r = byId.get(m.id);
    row(`mf:${m.id}`, `${m.namespace}.${m.key}`, "metafield", (code) => (r ? cellFor(r.translatableContent ?? [], translationsOf(r, code), "value") : NO_CELL));
  };

  let ns = 0;
  let mf = 0;
  for (const r of settings.translation.rows) {
    switch (r.type) {
      case "core":
        row(r.field, CORE_FIELD_LABEL[r.field], "product", (code) => cellFor(product?.translatableContent ?? [], translationsOf(product ?? {}, code), r.field));
        break;
      case "namespace": {
        const list = nodesOf(base, `ns${ns++}`);
        if (list.length >= 50) notes.push(`Only the first 50 metafields in "${r.namespace}" are checked.`);
        list.forEach(metafieldRow);
        break;
      }
      case "metafield": {
        const m = oneOf(base, `mf${mf++}`);
        if (m) metafieldRow(m);
        break;
      }
      case "optionNames":
        for (const o of base.product?.options ?? []) {
          const res = byId.get(o.id);
          row(`opt:${o.id}`, `Option name: ${o.name}`, "option", (code) => (res ? cellFor(res.translatableContent ?? [], translationsOf(res, code), "name") : NO_CELL));
        }
        break;
      case "optionValues":
        for (const o of base.product?.options ?? []) {
          const values = o.optionValues.map((v) => byId.get(v.id)).filter((x): x is Resource => !!x);
          row(`optv:${o.id}`, `Option values: ${o.name}`, "option", (code) => groupCell(values.map((v) => cellFor(v.translatableContent ?? [], translationsOf(v, code), "name"))));
        }
        break;
    }
  }

  const totals: Record<string, Totals> = {};
  for (const c of codes) {
    const cells = rows.map((r) => r.cells[c]!).filter((x) => x.status !== "none");
    totals[c] = {
      total: cells.length,
      translated: cells.filter((x) => x.status === "translated").length,
      missing: cells.filter((x) => x.status === "missing").length,
      same: cells.filter((x) => x.status === "same").length,
    };
  }
  return { languages, rows, totals, notes };
}

export async function load(ctx: LoadContext): Promise<Data> {
  const settings = settingsOf(ctx);
  const base = await ctx.q<BaseRaw>(BASE(settings), { id: ctx.productId });
  if (!base.product) throw new Error("Product not found");
  const ids = nestedIds(base, settings);
  const nested = ids.length ? await loadNested(ctx.q, ids, settings.languages) : [];
  return shape(base, nested, settings);
}
