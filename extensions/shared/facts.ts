// The one reader of facts about a product. Product health, Data quality, Content snapshot and Options and swatches all
// read through it, so they never disagree. It asks for the minimum (a `Need`), pages through variants and images, and
// never throws for an optional part: a part that could not be read is marked "failed" and the rules say "unknown".
//
// Pure: no Shopify global. The blocks pass their query functions in (LoadContext).

import { hasEdgeSpace, normalizeText } from "./format";
import { aliasOf, gqlString, numericId } from "./pure";
import type { LoadContext, Query } from "./query";
import type { BlockSettings, FieldRef, ThemeField } from "./settings";

export type MetaValue = { value: string | null; type: string | null };
export type ReadState = "ok" | "failed" | "skipped";

export type VariantFact = {
  id: string;
  title: string;
  selectedOptions: { name: string; value: string }[];
  price: number | null;
  /** null = not set. */
  compareAt: number | null;
  /** The next four are undefined when the details could not be read (see `read.variantExtras`). */
  sku?: string | null;
  weight?: number | null;
  cost?: number | null;
  hasImage?: boolean;
  fields: Record<string, MetaValue | null>;
};

export type LinkedProduct = { token: string; handle: string; found: boolean; status: string | null; published: boolean; self: boolean };

export type ProductFacts = {
  id: string;
  numericId: string;
  handle: string;
  title: string;
  status: string;
  productType: string;
  tags: string[];
  category: string | null;
  description: string;
  bodyWords: number;
  seoTitle: string;
  seoDescription: string;
  images: { id: string; alt: string }[];
  imagesTruncated: boolean;
  options: { name: string; values: string[] }[];
  variants: VariantFact[];
  variantsTruncated: boolean;
  fields: Record<string, MetaValue | null>;
  publishedCatalogIds: string[];
  duplicates: { handle: string; title: string }[];
  /** Products named in a handle-list theme field, by field alias. */
  linked: Record<string, LinkedProduct[]>;
  read: { content: ReadState; media: ReadState; variants: ReadState; variantExtras: ReadState; publications: ReadState; duplicates: ReadState; linked: ReadState };
  /** Plain lines for the grey note under a block. */
  notes: string[];
};

/** What a block needs. Everything is off unless asked for. */
export type Need = {
  content?: boolean;
  media?: boolean;
  options?: boolean;
  variants?: boolean;
  publications?: boolean;
  duplicates?: boolean;
  /** Metafields to read. Product ones sit on the product, variant ones on every variant. */
  fields?: FieldRef[];
  /** Handle-list fields whose products are looked up (needs those fields in `fields`). */
  handleFields?: FieldRef[];
};

export const MAX_VARIANTS = 250;
const VARIANT_PAGE = 125;
const MEDIA_PAGE = 50;
const MAX_MEDIA_PAGES = 4;

export const fieldAlias = (f: Pick<FieldRef, "namespace" | "key">) => `m_${aliasOf(f.namespace)}_${aliasOf(f.key)}`;
const uniqueFields = (fields: FieldRef[]) => [...new Map(fields.map((f) => [fieldAlias(f), f])).values()];
const selection = (fields: FieldRef[]) => uniqueFields(fields).map((f) => `${fieldAlias(f)}: metafield(namespace: ${gqlString(f.namespace)}, key: ${gqlString(f.key)}) { value type }`).join("\n    ");

// ---------------------------------------------------------------- which metafields a settings object needs

/** Every metafield the health checks read for these settings. Theme fields are read for any kind of product, because the kind is only known after the read. */
export function healthFields(s: BlockSettings): FieldRef[] {
  const out: FieldRef[] = [];
  for (const f of s.themeFields) {
    if (!f.on || f.profiles.length === 0) continue;
    out.push({ label: f.label, namespace: f.namespace, key: f.key, owner: f.owner });
    if (f.rule === "sameAs" && f.other) out.push({ label: f.other.key, namespace: f.other.namespace, key: f.other.key, owner: "product" });
  }
  for (const c of s.quality.checks) {
    if (!c.on) continue;
    if (c.kind === "lengthSeater") out.push(...s.quality.fields.length, ...s.quality.fields.seater);
    if (c.kind === "lead") out.push(...s.quality.fields.leadTime);
    if (c.kind === "metafield" && c.field) out.push(c.field);
  }
  out.push(s.records.swatchField, s.records.hideField);
  return [...new Map(out.map((f) => [`${f.owner}:${fieldAlias(f)}`, f])).values()];
}

export const handleFieldsOf = (fields: ThemeField[]): FieldRef[] => fields.filter((f) => f.on && f.profiles.length > 0 && (f.rule === "handles" || f.rule === "targets") && f.owner === "product").map((f) => ({ label: f.label, namespace: f.namespace, key: f.key, owner: "product" }));

/** The need of the blocks that run the full set of checks. */
export const healthNeed = (s: BlockSettings): Need => ({
  content: true,
  media: true,
  options: true,
  variants: true,
  publications: true,
  duplicates: true,
  fields: healthFields(s),
  handleFields: handleFieldsOf(s.themeFields),
});

// ---------------------------------------------------------------- queries

const VARIANT_BASIC = "id title price compareAtPrice selectedOptions { name value }";
const VARIANT_EXTRA = "sku media(first: 1) { nodes { id } } inventoryItem { unitCost { amount } measurement { weight { value unit } } }";

const variantSelection = (extras: boolean, fields: FieldRef[]) => `${VARIANT_BASIC}${extras ? `\n        ${VARIANT_EXTRA}` : ""}\n        ${selection(fields)}`;

function productQuery(need: Need, extras: boolean): string {
  const productFields = (need.fields ?? []).filter((f) => f.owner === "product");
  const variantFields = (need.fields ?? []).filter((f) => f.owner === "variant");
  return `query FactsProduct($id: ID!) {
  product(id: $id) {
    id handle title status productType tags category { name }
    ${need.content ? "description\n    seo { title description }" : ""}
    ${need.options ? "options { name values }" : ""}
    ${need.media ? `media(first: ${MEDIA_PAGE}) { ${MEDIA_SEL} }` : ""}
    ${need.publications ? "resourcePublicationsV2(first: 20, onlyPublished: true, catalogType: MARKET) { nodes { publication { catalog { id } } } }" : ""}
    ${selection(productFields)}
    ${need.variants ? `variants(first: ${VARIANT_PAGE}) {\n      nodes {\n        ${variantSelection(extras, variantFields)}\n      }\n      pageInfo { hasNextPage endCursor }\n    }` : ""}
  }
}`;
}

const variantsQuery = (extras: boolean, fields: FieldRef[]) => `query FactsVariants($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: ${VARIANT_PAGE}, after: $after) {
      nodes {
        ${variantSelection(extras, fields)}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const MEDIA_SEL = "nodes { id alt mediaContentType } pageInfo { hasNextPage endCursor }";
const MEDIA_MORE = `query FactsMedia($id: ID!, $after: String) { product(id: $id) { media(first: ${MEDIA_PAGE}, after: $after) { ${MEDIA_SEL} } } }`;

const TITLES = `query FactsTitles($q: String!) { products(first: 25, query: $q) { nodes { id handle title } } }`;

const LP = "id handle status resourcePublicationsV2(first: 1, onlyPublished: true, catalogType: MARKET) { nodes { __typename } }";
const LINKED = `query FactsLinked($ids: [ID!]!, $q: String!) { nodes(ids: $ids) { ... on Product { ${LP} } } products(first: 100, query: $q) { nodes { ${LP} } } }`;

// ---------------------------------------------------------------- raw shapes

type RawMeta = { value?: string | null; type?: string | null } | null | undefined;
type RawVariant = {
  id: string;
  title: string;
  price?: string | null;
  compareAtPrice?: string | null;
  selectedOptions?: { name: string; value: string }[];
  sku?: string | null;
  media?: { nodes: unknown[] } | null;
  inventoryItem?: { unitCost?: { amount?: string | null } | null; measurement?: { weight?: { value?: number | string | null } | null } | null } | null;
} & Record<string, unknown>;
type RawMedia = { nodes: { id: string; alt?: string | null; mediaContentType: string }[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };
type RawVariants = { nodes: RawVariant[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };
type RawProduct = {
  id: string;
  handle: string;
  title: string;
  status: string;
  productType?: string | null;
  tags?: string[];
  category?: { name?: string | null } | null;
  description?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
  options?: { name: string; values: string[] }[];
  media?: RawMedia;
  resourcePublicationsV2?: { nodes: { publication?: { catalog?: { id: string } | null } | null }[] } | null;
  variants?: RawVariants;
} & Record<string, unknown>;

// ---------------------------------------------------------------- small pure helpers

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const metaOf = (raw: unknown): MetaValue | null => {
  const m = raw as RawMeta;
  return m ? { value: m.value ?? null, type: m.type ?? null } : null;
};

export const wordCount = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Splits the value of a handle-list metafield: a JSON list, or words separated by commas, spaces or new lines. */
export function parseTokens(value: string | null | undefined): string[] {
  const text = (value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
    } catch {
      // fall through to the plain split
    }
  }
  return text.split(/[\s,;]+/).map((x) => x.replace(/^["']+|["']+$/g, "")).filter(Boolean);
}

const HANDLE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;

/** The value of a field as plain text ("" when empty or missing). */
export const textOf = (m: MetaValue | null | undefined): string => m?.value ?? "";
export const isBlank = (m: MetaValue | null | undefined): boolean => !textOf(m).trim();

export const looksSpaced = (s: string) => hasEdgeSpace(s) || /\s{2,}/.test(s);
export const sameText = (a: string, b: string) => normalizeText(a).toLowerCase() === normalizeText(b).toLowerCase();

// ---------------------------------------------------------------- shaping

export function shapeFacts(product: RawProduct, extra: { variants: RawVariant[]; variantsTruncated: boolean; media: RawMedia["nodes"]; mediaTruncated: boolean; extras: boolean }, need: Need, read: ProductFacts["read"], notes: string[]): ProductFacts {
  const fields: Record<string, MetaValue | null> = {};
  for (const f of (need.fields ?? []).filter((x) => x.owner === "product")) fields[fieldAlias(f)] = metaOf(product[fieldAlias(f)]);
  const variantFields = (need.fields ?? []).filter((x) => x.owner === "variant");
  const description = (product.description ?? "").trim();
  return {
    id: product.id,
    numericId: numericId(product.id),
    handle: product.handle,
    title: product.title,
    status: product.status,
    productType: product.productType ?? "",
    tags: product.tags ?? [],
    category: product.category?.name ?? null,
    description,
    bodyWords: wordCount(description),
    seoTitle: product.seo?.title ?? "",
    seoDescription: product.seo?.description ?? "",
    images: extra.media.filter((m) => m.mediaContentType === "IMAGE").map((m) => ({ id: m.id, alt: m.alt ?? "" })),
    imagesTruncated: extra.mediaTruncated,
    options: product.options ?? [],
    variants: extra.variants.map((v) => {
      const weight = toNumber(v.inventoryItem?.measurement?.weight?.value);
      return {
        id: v.id,
        title: v.title,
        selectedOptions: v.selectedOptions ?? [],
        price: toNumber(v.price),
        compareAt: toNumber(v.compareAtPrice),
        ...(extra.extras
          ? {
              sku: v.sku ?? null,
              weight: weight ?? 0,
              cost: toNumber(v.inventoryItem?.unitCost?.amount),
              hasImage: (v.media?.nodes.length ?? 0) > 0,
            }
          : {}),
        fields: Object.fromEntries(variantFields.map((f) => [fieldAlias(f), metaOf(v[fieldAlias(f)])])),
      };
    }),
    variantsTruncated: extra.variantsTruncated,
    fields,
    publishedCatalogIds: (product.resourcePublicationsV2?.nodes ?? []).map((n) => n.publication?.catalog?.id).filter((x): x is string => !!x),
    duplicates: [],
    linked: {},
    read,
    notes,
  };
}

/** Looks up the products named by handle-list fields and fills `facts.linked`. */
export function resolveLinked(facts: ProductFacts, fields: FieldRef[], found: { id: string; handle: string; status: string; published: boolean }[]): void {
  for (const f of fields) {
    const alias = fieldAlias(f);
    const tokens = parseTokens(facts.fields[alias]?.value);
    facts.linked[alias] = tokens.map((token) => {
      const hit = found.find((p) => p.id === token || p.handle === token);
      const handle = hit?.handle ?? token;
      return { token, handle, found: !!hit, status: hit?.status ?? null, published: !!hit && hit.status === "ACTIVE" && hit.published, self: hit?.id === facts.id || token === facts.handle };
    });
  }
}

// ---------------------------------------------------------------- loading

type Soft = LoadContext["soft"];

async function pageVariants(q: Query, first: RawVariants, productId: string, extras: boolean, fields: FieldRef[]): Promise<{ variants: RawVariant[]; truncated: boolean }> {
  const variants = [...first.nodes];
  let page = first.pageInfo;
  while (page.hasNextPage && page.endCursor && variants.length < MAX_VARIANTS) {
    const more = await q<{ product: { variants: RawVariants } | null }>(variantsQuery(extras, fields), { id: productId, after: page.endCursor });
    if (!more.product) break;
    variants.push(...more.product.variants.nodes);
    page = more.product.variants.pageInfo;
  }
  return { variants: variants.slice(0, MAX_VARIANTS), truncated: page.hasNextPage || variants.length > MAX_VARIANTS };
}

async function pageMedia(q: Query, first: RawMedia, productId: string): Promise<{ media: RawMedia["nodes"]; truncated: boolean }> {
  const media = [...first.nodes];
  let page = first.pageInfo;
  let pages = 1;
  while (page.hasNextPage && page.endCursor && pages < MAX_MEDIA_PAGES) {
    const more = await q<{ product: { media: RawMedia } | null }>(MEDIA_MORE, { id: productId, after: page.endCursor });
    if (!more.product) break;
    media.push(...more.product.media.nodes);
    page = more.product.media.pageInfo;
    pages++;
  }
  return { media, truncated: page.hasNextPage };
}

async function duplicatesOf(soft: Soft, product: RawProduct): Promise<{ state: ReadState; list: { handle: string; title: string }[] }> {
  const title = product.title.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  if (!title) return { state: "ok", list: [] };
  const res = await soft<{ products: { nodes: { id: string; handle: string; title: string }[] } }>(TITLES, { q: `title:"${title}"` });
  if (!res.data) return { state: "failed", list: [] };
  const list = res.data.products.nodes.filter((p) => p.id !== product.id && sameText(p.title, product.title)).map((p) => ({ handle: p.handle, title: p.title }));
  return { state: "ok", list };
}

async function linkedOf(soft: Soft, facts: ProductFacts, fields: FieldRef[]): Promise<ReadState> {
  const tokens = fields.flatMap((f) => parseTokens(facts.fields[fieldAlias(f)]?.value));
  if (!tokens.length) {
    resolveLinked(facts, fields, []);
    return "ok";
  }
  const ids = [...new Set(tokens.filter((t) => PRODUCT_GID.test(t)))];
  const handles = [...new Set(tokens.filter((t) => HANDLE_RE.test(t)))];
  const res = await soft<{ nodes: ({ id?: string; handle?: string; status?: string; resourcePublicationsV2?: { nodes: unknown[] } } | null)[]; products: { nodes: { id: string; handle: string; status: string; resourcePublicationsV2?: { nodes: unknown[] } }[] } }>(LINKED, {
    ids,
    q: handles.length ? handles.map((h) => `handle:${h}`).join(" OR ") : "handle:__none__",
  });
  if (!res.data) return "failed";
  const all = [...(res.data.nodes ?? []), ...(res.data.products?.nodes ?? [])].filter((p): p is { id: string; handle: string; status: string; resourcePublicationsV2?: { nodes: unknown[] } } => !!p && typeof p.id === "string" && typeof p.handle === "string");
  resolveLinked(facts, fields, all.map((p) => ({ id: p.id, handle: p.handle, status: p.status, published: (p.resourcePublicationsV2?.nodes.length ?? 0) > 0 })));
  return "ok";
}

/**
 * Reads the product once, with the minimum fields for `need`. The first request asks for everything, including the
 * optional variant details (SKU, weight, cost, image). If Shopify refuses those, the request is repeated without them
 * and the rules for them say "could not be read" instead of guessing.
 */
export async function loadFacts(ctx: Pick<LoadContext, "productId" | "q" | "soft">, need: Need): Promise<ProductFacts> {
  const { productId, q, soft } = ctx;
  const notes: string[] = [];
  const variantFields = (need.fields ?? []).filter((f) => f.owner === "variant");
  let extras = !!need.variants;
  let product: RawProduct | null = null;
  let variantExtras: ReadState = need.variants ? "ok" : "skipped";

  const full = await soft<{ product: RawProduct | null }>(productQuery(need, extras), { id: productId });
  if (full.data?.product) {
    product = full.data.product;
    if (full.error) {
      notes.push(`Some details could not be read: ${full.error.message}`);
      if (need.variants) variantExtras = "failed";
    }
  } else if (extras) {
    extras = false;
    variantExtras = "failed";
    const basic = await q<{ product: RawProduct | null }>(productQuery(need, false), { id: productId });
    product = basic.product;
    notes.push("SKU, weight, cost and variant images could not be read, so those checks are left out.");
  } else {
    const only = await q<{ product: RawProduct | null }>(productQuery(need, false), { id: productId });
    product = only.product;
  }
  if (!product) throw new Error("Product not found");
  const extrasRead = extras && variantExtras === "ok";

  let variants: RawVariant[] = [];
  let variantsTruncated = false;
  if (need.variants && product.variants) {
    const paged = await pageVariants(q, product.variants, productId, extrasRead, variantFields);
    variants = paged.variants;
    variantsTruncated = paged.truncated;
    if (variantsTruncated) notes.push(`First ${MAX_VARIANTS} variants checked.`);
  }
  let media: RawMedia["nodes"] = [];
  let mediaTruncated = false;
  if (need.media && product.media) {
    const paged = await pageMedia(q, product.media, productId);
    media = paged.media;
    mediaTruncated = paged.truncated;
    if (mediaTruncated) notes.push(`First ${media.length} media files checked.`);
  }

  const read: ProductFacts["read"] = {
    content: need.content ? "ok" : "skipped",
    media: need.media ? "ok" : "skipped",
    variants: need.variants ? "ok" : "skipped",
    variantExtras: need.variants ? (extrasRead ? "ok" : "failed") : "skipped",
    publications: need.publications ? "ok" : "skipped",
    duplicates: "skipped",
    linked: "skipped",
  };
  const facts = shapeFacts(product, { variants, variantsTruncated, media, mediaTruncated, extras: extrasRead }, need, read, notes);

  const [dup, linked] = await Promise.all([
    need.duplicates ? duplicatesOf(soft, product) : Promise.resolve(null),
    need.handleFields?.length ? linkedOf(soft, facts, need.handleFields) : Promise.resolve(null),
  ]);
  if (dup) {
    facts.read.duplicates = dup.state;
    facts.duplicates = dup.list;
    if (dup.state === "failed") notes.push("Other products with the same title could not be looked up.");
  }
  if (linked) {
    facts.read.linked = linked;
    if (linked === "failed") notes.push("Related products could not be looked up.");
  }
  return facts;
}
