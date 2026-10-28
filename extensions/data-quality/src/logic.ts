import { hasEdgeSpace, plural, shortList } from "../../shared/format";
import { aliasOf, gqlString } from "../../shared/pure";
import type { LoadContext, Query } from "../../shared/query";
import { defaultSettings, settingsOf, type BlockSettings, type FieldRef } from "../../shared/settings";

type FieldDef = FieldRef;

export type CheckStatus = "pass" | "fail" | "skipped";
export type Check = { id: string; label: string; status: CheckStatus; reason: string };
export type Data = { checks: Check[]; passed: number; counted: number; notes: string[] };

type RawVariant = { id: string; title: string; price: string; selectedOptions?: { name: string; value: string }[] } & Record<string, unknown>;
type RawProduct = {
  id: string;
  status: string;
  seo?: { title?: string | null; description?: string | null } | null;
  media: { nodes: { alt?: string | null; mediaContentType: string }[]; pageInfo: { hasNextPage: boolean } };
  resourcePublicationsV2?: { nodes: unknown[] } | null;
  variants: { nodes: RawVariant[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };
} & Record<string, unknown>;

/** The metafields the switched-on checks need, so the query asks for nothing else. */
export function neededFields(s: BlockSettings): FieldDef[] {
  const on = s.quality.checks.filter((c) => c.on);
  const out: FieldDef[] = [];
  for (const c of on) {
    if (c.kind === "lengthSeater") out.push(...s.quality.fields.length, ...s.quality.fields.seater);
    if (c.kind === "lead") out.push(...s.quality.fields.leadTime);
    if (c.kind === "metafield" && c.field) out.push(c.field);
  }
  return out;
}
export const fieldAlias = (f: FieldDef) => `m_${aliasOf(f.namespace)}_${aliasOf(f.key)}`;
const selection = (fields: FieldDef[]) => fields.map((f) => `${fieldAlias(f)}: metafield(namespace: ${gqlString(f.namespace)}, key: ${gqlString(f.key)}) { value }`).join("\n        ");
const unique = (fields: FieldDef[]) => [...new Map(fields.map((f) => [fieldAlias(f), f])).values()];

const VARIANT_PAGE = 100;
const MAX_VARIANT_PAGES = 5;

const variantFields = (s: BlockSettings) => `id title price selectedOptions { name value }
        ${selection(unique(neededFields(s).filter((f) => f.owner === "variant")))}`;

const FIRST = (s: BlockSettings) => `query Quality($id: ID!) {
  product(id: $id) {
    id
    status
    seo { title description }
    media(first: 50) { nodes { alt mediaContentType } pageInfo { hasNextPage } }
    resourcePublicationsV2(first: 20, onlyPublished: true, catalogType: MARKET) { nodes { publication { id } } }
    ${selection(unique(neededFields(s).filter((f) => f.owner === "product")))}
    variants(first: ${VARIANT_PAGE}) {
      nodes {
        ${variantFields(s)}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const MORE = (s: BlockSettings) => `query QualityVariants($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: ${VARIANT_PAGE}, after: $after) {
      nodes {
        ${variantFields(s)}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const blank = (v: unknown) => !(typeof v === "string" ? v : (v as { value?: string } | null | undefined)?.value ?? "").trim();

/** Checks that every field in `fields` has a value; says what is missing. */
export function fieldsFilled(product: RawProduct, variants: RawVariant[], fields: FieldDef[]): { ok: boolean; reason: string } {
  const problems: string[] = [];
  for (const f of fields) {
    const a = fieldAlias(f);
    if (f.owner === "variant") {
      const missing = variants.filter((v) => blank(v[a])).length;
      if (missing) problems.push(`${f.label} is empty on ${missing} of ${plural(variants.length, "variant")}`);
    } else if (blank(product[a])) {
      problems.push(`${f.label} is empty`);
    }
  }
  return { ok: !problems.length, reason: problems.join("; ") };
}

const NOT_SET_HERE = "Not configured: add the metafield keys on the Settings page of the app.";

export function evaluate(product: RawProduct, variants: RawVariant[], notes: string[] = [], settings: BlockSettings = defaultSettings()): Data {
  const images = product.media.nodes.filter((m) => m.mediaContentType === "IMAGE");
  const noAlt = images.filter((m) => !(m.alt ?? "").trim());
  const spaced = variants.filter((v) => hasEdgeSpace(v.title) || (v.selectedOptions ?? []).some((o) => hasEdgeSpace(o.value)));
  const zero = variants.filter((v) => !(Number(v.price) > 0));
  const markets = product.resourcePublicationsV2?.nodes.length ?? 0;
  const seoMissing = [!(product.seo?.title ?? "").trim() ? "SEO title" : "", !(product.seo?.description ?? "").trim() ? "SEO description" : ""].filter(Boolean);

  const checks: Check[] = [];
  for (const c of settings.quality.checks) {
    if (!c.on) continue;
    const { id, label } = c;
    const pass = (): Check => ({ id, label, status: "pass", reason: "" });
    const fail = (reason: string): Check => ({ id, label, status: "fail", reason });
    const skipped = (reason: string): Check => ({ id, label, status: "skipped", reason });
    switch (c.kind) {
      case "image":
        checks.push(images.length ? pass() : fail("The product has no images."));
        break;
      case "alt":
        checks.push(!images.length ? fail("No images, so there is no alt text.") : noAlt.length ? fail(`${noAlt.length} of ${plural(images.length, "image")} ${noAlt.length === 1 ? "has" : "have"} no alt text.`) : pass());
        break;
      case "spaces":
        checks.push(spaced.length ? fail(`${plural(spaced.length, "variant")} with a space at the start or end: ${shortList(spaced.map((v) => `"${v.title}"`))}.`) : pass());
        break;
      case "lengthSeater": {
        const fields = [...settings.quality.fields.length, ...settings.quality.fields.seater];
        if (!fields.length) {
          checks.push(skipped(NOT_SET_HERE));
          break;
        }
        const r = fieldsFilled(product, variants, fields);
        checks.push(r.ok ? pass() : fail(`${r.reason}.`));
        break;
      }
      case "seo":
        checks.push(seoMissing.length ? fail(`${seoMissing.join(" and ")} not set.`) : pass());
        break;
      case "lead": {
        const fields = settings.quality.fields.leadTime;
        if (!fields.length) {
          checks.push(skipped(NOT_SET_HERE));
          break;
        }
        const r = fieldsFilled(product, variants, fields);
        checks.push(r.ok ? pass() : fail(`${r.reason}.`));
        break;
      }
      case "price":
        checks.push(!variants.length ? fail("The product has no variants.") : zero.length ? fail(`${plural(zero.length, "variant")} priced at 0 or less.`) : pass());
        break;
      case "market":
        checks.push(markets ? pass() : fail("Not in any market catalogue."));
        break;
      case "metafield": {
        if (!c.field) {
          checks.push(skipped("Not configured: choose the metafield on the Settings page of the app."));
          break;
        }
        const r = fieldsFilled(product, variants, [c.field]);
        checks.push(r.ok ? pass() : fail(`${r.reason}.`));
        break;
      }
    }
  }

  const counted = checks.filter((c) => c.status !== "skipped");
  return { checks, passed: counted.filter((c) => c.status === "pass").length, counted: counted.length, notes };
}

export async function loadVariantPages(q: Query, productId: string, first: RawProduct["variants"], settings: BlockSettings = defaultSettings()): Promise<{ variants: RawVariant[]; complete: boolean }> {
  const variants = [...first.nodes];
  let page = first.pageInfo;
  let pages = 1;
  while (page.hasNextPage && page.endCursor && pages < MAX_VARIANT_PAGES) {
    const more = await q<{ product: { variants: RawProduct["variants"] } | null }>(MORE(settings), { id: productId, after: page.endCursor });
    if (!more.product) break;
    variants.push(...more.product.variants.nodes);
    page = more.product.variants.pageInfo;
    pages++;
  }
  return { variants, complete: !page.hasNextPage };
}

export async function load(ctx: LoadContext): Promise<Data> {
  const { productId, q } = ctx;
  const settings = settingsOf(ctx);
  const data = await q<{ product: RawProduct | null }>(FIRST(settings), { id: productId });
  const product = data.product;
  if (!product) throw new Error("Product not found");
  const notes: string[] = [];
  const { variants, complete } = await loadVariantPages(q, productId, product.variants, settings);
  if (!complete) notes.push(`Only the first ${variants.length} variants were checked.`);
  if (product.media.pageInfo.hasNextPage) notes.push("Only the first 50 media files were checked.");
  return evaluate(product, variants, notes, settings);
}
