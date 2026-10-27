import { LANGUAGES, TRANSLATED_METAFIELD_NAMESPACES } from "../../shared/constants";
import { aliasOf, gqlString, localeLiteral, type LoadContext, type Query } from "../../shared/graphql";
import { cellFor, groupCell, NO_CELL, type Cell, type Content, type Translations } from "../../shared/translations";

export type FieldRow = { key: string; label: string; group: "product" | "metafield" | "option"; cells: Record<string, Cell> };
export type Totals = { translated: number; missing: number; same: number; total: number };
export type Data = { languages: { code: string; label: string }[]; rows: FieldRow[]; totals: Record<string, Totals>; notes: string[] };

type Resource = { resourceId?: string; translatableContent?: Content } & Record<string, unknown>;

const alias = (code: string) => `tr_${aliasOf(code)}`;
const localeFields = () => LANGUAGES.map((l) => `${alias(l.code)}: translations(locale: ${localeLiteral(l.code)}) { key value outdated }`).join("\n    ");

const PRODUCT_FIELDS: { key: string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "body_html", label: "Description" },
  { key: "meta_title", label: "SEO title" },
  { key: "meta_description", label: "SEO description" },
  { key: "handle", label: "Handle (URL)" },
];

const BASE = () => `query TranslationBase($id: ID!) {
  product(id: $id) {
    id
    options { id name optionValues { id name } }
    ${TRANSLATED_METAFIELD_NAMESPACES.map((ns, i) => `ns${i}: metafields(first: 50, namespace: ${gqlString(ns)}) { nodes { id namespace key } }`).join("\n    ")}
  }
  translatableResource(resourceId: $id) {
    translatableContent { key value }
    ${localeFields()}
  }
}`;

const NESTED = () => `query TranslationNested($ids: [ID!]!) {
  translatableResourcesByIds(first: 50, resourceIds: $ids) {
    nodes {
      resourceId
      translatableContent { key value }
      ${localeFields()}
    }
  }
}`;

const translationsOf = (r: Resource, code: string): Translations => (r[alias(code)] as Translations | undefined) ?? [];

type BaseRaw = {
  product: ({ id: string; options: { id: string; name: string; optionValues: { id: string; name: string }[] }[] } & Record<string, unknown>) | null;
  translatableResource: ({ translatableContent: Content } & Record<string, unknown>) | null;
};
type NestedRaw = { translatableResourcesByIds: { nodes: Resource[] } };

async function loadNested(q: Query, ids: string[]): Promise<Resource[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const parts = await Promise.all(chunks.map((c) => q<NestedRaw>(NESTED(), { ids: c })));
  return parts.flatMap((p) => p.translatableResourcesByIds.nodes);
}

export function shape(base: BaseRaw, nested: Resource[]): Data {
  const notes: string[] = [];
  const byId = new Map(nested.map((r) => [r.resourceId ?? "", r]));
  const rows: FieldRow[] = [];
  const codes = LANGUAGES.map((l) => l.code);
  const product = base.translatableResource;

  const row = (key: string, label: string, group: FieldRow["group"], cellFor_: (code: string) => Cell) => {
    const cells = Object.fromEntries(codes.map((c) => [c, cellFor_(c)]));
    if (Object.values(cells).every((c) => c.status === "none")) return;
    rows.push({ key, label, group, cells });
  };

  for (const f of PRODUCT_FIELDS) row(f.key, f.label, "product", (code) => cellFor(product?.translatableContent ?? [], translationsOf(product ?? {}, code), f.key));

  TRANSLATED_METAFIELD_NAMESPACES.forEach((_, i) => {
    const list = (base.product?.[`ns${i}`] as { nodes: { id: string; namespace: string; key: string }[] } | undefined)?.nodes ?? [];
    if (list.length >= 50) notes.push(`Only the first 50 metafields in "${TRANSLATED_METAFIELD_NAMESPACES[i]}" are checked.`);
    for (const m of list) {
      const r = byId.get(m.id);
      row(`mf:${m.id}`, `${m.namespace}.${m.key}`, "metafield", (code) => (r ? cellFor(r.translatableContent ?? [], translationsOf(r, code), "value") : NO_CELL));
    }
  });

  for (const o of base.product?.options ?? []) {
    const r = byId.get(o.id);
    row(`opt:${o.id}`, `Option name: ${o.name}`, "option", (code) => (r ? cellFor(r.translatableContent ?? [], translationsOf(r, code), "name") : NO_CELL));
    const values = o.optionValues.map((v) => byId.get(v.id)).filter((x): x is Resource => !!x);
    row(`optv:${o.id}`, `Option values: ${o.name}`, "option", (code) => groupCell(values.map((v) => cellFor(v.translatableContent ?? [], translationsOf(v, code), "name"))));
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
  return { languages: LANGUAGES, rows, totals, notes };
}

export async function load({ productId, q }: LoadContext): Promise<Data> {
  const base = await q<BaseRaw>(BASE(), { id: productId });
  if (!base.product) throw new Error("Product not found");
  const ids: string[] = [];
  for (const o of base.product.options) {
    ids.push(o.id, ...o.optionValues.map((v) => v.id));
  }
  TRANSLATED_METAFIELD_NAMESPACES.forEach((_, i) => {
    const list = (base.product?.[`ns${i}`] as { nodes: { id: string }[] } | undefined)?.nodes ?? [];
    ids.push(...list.map((m) => m.id));
  });
  const nested = ids.length ? await loadNested(q, ids) : [];
  return shape(base, nested);
}
