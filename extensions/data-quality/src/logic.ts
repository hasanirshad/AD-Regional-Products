import { REQUIRED_FIELDS, type FieldDef } from "../../shared/constants";
import { gqlString, aliasOf, type LoadContext, type Query } from "../../shared/graphql";
import { hasEdgeSpace, plural, shortList } from "../../shared/format";

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

const allFields = (): FieldDef[] => [...REQUIRED_FIELDS.length, ...REQUIRED_FIELDS.seater, ...REQUIRED_FIELDS.leadTime];
export const fieldAlias = (f: FieldDef) => `m_${aliasOf(f.namespace)}_${aliasOf(f.key)}`;
const selection = (fields: FieldDef[]) => fields.map((f) => `${fieldAlias(f)}: metafield(namespace: ${gqlString(f.namespace)}, key: ${gqlString(f.key)}) { value }`).join("\n        ");
const unique = (fields: FieldDef[]) => [...new Map(fields.map((f) => [fieldAlias(f), f])).values()];

const VARIANT_PAGE = 100;
const MAX_VARIANT_PAGES = 5;

const variantFields = () => `id title price selectedOptions { name value }
        ${selection(unique(allFields().filter((f) => f.owner === "variant")))}`;

const FIRST = () => `query Quality($id: ID!) {
  product(id: $id) {
    id
    status
    seo { title description }
    media(first: 50) { nodes { alt mediaContentType } pageInfo { hasNextPage } }
    resourcePublicationsV2(first: 20, onlyPublished: true, catalogType: MARKET) { nodes { publication { id } } }
    ${selection(unique(allFields().filter((f) => f.owner === "product")))}
    variants(first: ${VARIANT_PAGE}) {
      nodes {
        ${variantFields()}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const MORE = () => `query QualityVariants($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: ${VARIANT_PAGE}, after: $after) {
      nodes {
        ${variantFields()}
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

export function evaluate(product: RawProduct, variants: RawVariant[], notes: string[] = []): Data {
  const images = product.media.nodes.filter((m) => m.mediaContentType === "IMAGE");
  const noAlt = images.filter((m) => !(m.alt ?? "").trim());
  const spaced = variants.filter((v) => hasEdgeSpace(v.title) || (v.selectedOptions ?? []).some((o) => hasEdgeSpace(o.value)));
  const zero = variants.filter((v) => !(Number(v.price) > 0));
  const markets = product.resourcePublicationsV2?.nodes.length ?? 0;
  const seoMissing = [!(product.seo?.title ?? "").trim() ? "SEO title" : "", !(product.seo?.description ?? "").trim() ? "SEO description" : ""].filter(Boolean);
  const lengthSeater = fieldsFilled(product, variants, [...REQUIRED_FIELDS.length, ...REQUIRED_FIELDS.seater]);
  const leadConfigured = REQUIRED_FIELDS.leadTime.length > 0;
  const lead = leadConfigured ? fieldsFilled(product, variants, REQUIRED_FIELDS.leadTime) : { ok: true, reason: "" };

  const pass = (id: string, label: string): Check => ({ id, label, status: "pass", reason: "" });
  const fail = (id: string, label: string, reason: string): Check => ({ id, label, status: "fail", reason });

  const checks: Check[] = [
    images.length ? pass("image", "At least one image") : fail("image", "At least one image", "The product has no images."),
    !images.length
      ? fail("alt", "Image alt text", "No images, so there is no alt text.")
      : noAlt.length
        ? fail("alt", "Image alt text", `${noAlt.length} of ${plural(images.length, "image")} ${noAlt.length === 1 ? "has" : "have"} no alt text.`)
        : pass("alt", "Image alt text"),
    spaced.length
      ? fail("spaces", "Variant titles have no extra spaces", `${plural(spaced.length, "variant")} with a space at the start or end: ${shortList(spaced.map((v) => `"${v.title}"`))}.`)
      : pass("spaces", "Variant titles have no extra spaces"),
    lengthSeater.ok ? pass("lengthSeater", "Length and seater filled") : fail("lengthSeater", "Length and seater filled", `${lengthSeater.reason}.`),
    seoMissing.length ? fail("seo", "SEO title and description", `${seoMissing.join(" and ")} not set.`) : pass("seo", "SEO title and description"),
    !leadConfigured
      ? { id: "lead", label: "Lead time set", status: "skipped", reason: "Not configured: add the lead-time metafield keys to the constants file." }
      : lead.ok
        ? pass("lead", "Lead time set")
        : fail("lead", "Lead time set", `${lead.reason}.`),
    !variants.length ? fail("price", "Price above zero", "The product has no variants.") : zero.length ? fail("price", "Price above zero", `${plural(zero.length, "variant")} priced at 0 or less.`) : pass("price", "Price above zero"),
    markets ? pass("market", "Published to at least one market") : fail("market", "Published to at least one market", "Not in any market catalogue."),
  ];

  const counted = checks.filter((c) => c.status !== "skipped");
  return { checks, passed: counted.filter((c) => c.status === "pass").length, counted: counted.length, notes };
}

export async function loadVariantPages(q: Query, productId: string, first: RawProduct["variants"]): Promise<{ variants: RawVariant[]; complete: boolean }> {
  const variants = [...first.nodes];
  let page = first.pageInfo;
  let pages = 1;
  while (page.hasNextPage && page.endCursor && pages < MAX_VARIANT_PAGES) {
    const more = await q<{ product: { variants: RawProduct["variants"] } | null }>(MORE(), { id: productId, after: page.endCursor });
    if (!more.product) break;
    variants.push(...more.product.variants.nodes);
    page = more.product.variants.pageInfo;
    pages++;
  }
  return { variants, complete: !page.hasNextPage };
}

export async function load({ productId, q }: LoadContext): Promise<Data> {
  const data = await q<{ product: RawProduct | null }>(FIRST(), { id: productId });
  const product = data.product;
  if (!product) throw new Error("Product not found");
  const notes: string[] = [];
  const { variants, complete } = await loadVariantPages(q, productId, product.variants);
  if (!complete) notes.push(`Only the first ${variants.length} variants were checked.`);
  if (product.media.pageInfo.hasNextPage) notes.push("Only the first 50 media files were checked.");
  return evaluate(product, variants, notes);
}
