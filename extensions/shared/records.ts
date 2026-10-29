// Linked records: the metaobjects a product points to (swatches, design and customisation) and the delivery-time
// records. Reading metaobjects needs the permissions `read_metaobjects` (and `read_metaobject_definitions` for the
// Settings page). Without them every function here returns state "failed" and the rules say "could not be read".
//
// Nothing here is verified on the real store: the field names (group, group_key, group_priority, link) come from the
// store export. The shape of the answer is read defensively.

import { fieldAlias, parseTokens, type ProductFacts, type ReadState } from "./facts";
import { normalizeText } from "./format";
import type { LoadContext } from "./query";
import type { BlockSettings } from "./settings";

export type MetaobjectFact = {
  id: string;
  type: string;
  handle: string;
  displayName: string;
  /** null = the type has no publishing status. */
  status: "ACTIVE" | "DRAFT" | null;
  fields: Record<string, string | null>;
};

export type RecordsFacts = {
  state: ReadState;
  message: string;
  /** Records the product (or its variants) point to, by id. */
  linked: Record<string, MetaobjectFact>;
  /** Every delivery-time record (null = not read). */
  delivery: MetaobjectFact[] | null;
};

export const EMPTY_RECORDS: RecordsFacts = { state: "skipped", message: "", linked: {}, delivery: null };

const OBJECT_FIELDS = `id type handle displayName capabilities { publishable { status } } fields { key value }`;

const BY_IDS = `query FactsRecords($ids: [ID!]!) { nodes(ids: $ids) { ... on Metaobject { ${OBJECT_FIELDS} } } }`;

const BY_TYPE = `query FactsDelivery($type: String!) { metaobjects(type: $type, first: 100) { nodes { ${OBJECT_FIELDS} } } }`;

type RawObject = { id?: string; type?: string; handle?: string; displayName?: string; capabilities?: { publishable?: { status?: string } | null } | null; fields?: { key: string; value?: string | null }[] };

export function shapeObject(o: RawObject): MetaobjectFact | null {
  if (!o || typeof o.id !== "string") return null;
  const status = o.capabilities?.publishable?.status;
  return {
    id: o.id,
    type: o.type ?? "",
    handle: o.handle ?? "",
    displayName: o.displayName ?? "",
    status: status === "ACTIVE" || status === "DRAFT" ? status : null,
    fields: Object.fromEntries((o.fields ?? []).map((f) => [f.key, f.value ?? null])),
  };
}

const METAOBJECT_GID = /^gid:\/\/shopify\/Metaobject\/\d+$/;

/** Ids of the metaobjects named by any metafield of the product or its variants. */
export function recordIds(facts: ProductFacts): string[] {
  const values = [...Object.values(facts.fields), ...facts.variants.flatMap((v) => Object.values(v.fields))];
  return [...new Set(values.flatMap((m) => parseTokens(m?.value)).filter((t) => METAOBJECT_GID.test(t)))];
}

/** The words that identify a product's wood or category, used to find its delivery-time record. */
export function deliveryKeys(facts: ProductFacts, s: BlockSettings): string[] {
  const wood = facts.fields[fieldAlias({ namespace: "custom", key: "product_wood_type" })]?.value ?? "";
  const material = facts.fields[fieldAlias({ namespace: "custom", key: "material-main-title" })]?.value ?? "";
  void s;
  return [...new Set([wood, material, facts.productType].map((x) => normalizeText(x).toLowerCase()).filter(Boolean))];
}

/** Delivery-time records for these keys: a record matches when its name, handle or any field equals a key. */
export function matchDelivery(all: MetaobjectFact[], keys: string[]): MetaobjectFact[] {
  if (!keys.length) return [];
  return all.filter((o) => {
    const texts = [o.displayName, o.handle, ...Object.values(o.fields)].map((x) => normalizeText(x ?? "").toLowerCase());
    return keys.some((k) => texts.includes(k));
  });
}

/** Looks like leftover test data: "Test 3", "Group 1", "1", "swatches test". */
export const looksLikeTest = (text: string | null | undefined): boolean => {
  const t = normalizeText(text ?? "");
  return t !== "" && (/\btest\b/i.test(t) || /^group\s*\d+$/i.test(t) || /^\d+$/.test(t));
};

export type RecordNeed = { linked: boolean; delivery: boolean };

/** Reads the linked and delivery records. Never throws: trouble means state "failed" with a plain message. */
export async function loadRecords(ctx: Pick<LoadContext, "soft">, facts: ProductFacts, s: BlockSettings, need: RecordNeed): Promise<RecordsFacts> {
  const ids = need.linked ? recordIds(facts) : [];
  const wantDelivery = need.delivery && s.records.deliveryType !== "";
  if (!ids.length && !wantDelivery) return { ...EMPTY_RECORDS, state: "ok" };
  const out: RecordsFacts = { state: "ok", message: "", linked: {}, delivery: null };
  const [byIds, byType] = await Promise.all([
    ids.length ? ctx.soft<{ nodes: (RawObject | null)[] }>(BY_IDS, { ids: ids.slice(0, 100) }) : Promise.resolve(null),
    wantDelivery ? ctx.soft<{ metaobjects: { nodes: RawObject[] } }>(BY_TYPE, { type: s.records.deliveryType }) : Promise.resolve(null),
  ]);
  const messages: string[] = [];
  if (byIds) {
    if (byIds.data) for (const o of byIds.data.nodes ?? []) { const f = o ? shapeObject(o) : null; if (f) out.linked[f.id] = f; }
    else messages.push(byIds.error?.message ?? "Linked records could not be read.");
  }
  if (byType) {
    if (byType.data) out.delivery = (byType.data.metaobjects?.nodes ?? []).map(shapeObject).filter((x): x is MetaobjectFact => !!x);
    else messages.push(byType.error?.message ?? "Delivery-time records could not be read.");
  }
  if (messages.length) {
    out.state = "failed";
    out.message = messages[0]!;
  }
  return out;
}
