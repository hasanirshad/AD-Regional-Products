// Storefront readiness: one row per market. Published comes from the shared market reader (the same one Market
// availability uses), so the two blocks never disagree.

import { loadFacts, type ProductFacts } from "../../shared/facts";
import { readMarketStates, type MarketState } from "../../shared/markets";
import { withPricing, type MarketPrice } from "../../shared/pricing";
import { aliasOf, gqlString, localeLiteral } from "../../shared/pure";
import { deliveryKeys, loadRecords, matchDelivery, type RecordsFacts } from "../../shared/records";
import type { LoadContext } from "../../shared/query";
import { marketCountries, marketDefs, settingsOf, type BlockSettings } from "../../shared/settings";
import { cellFor, type Content, type Translations } from "../../shared/translationCells";
import { storefrontUrl } from "../../quick-links/src/logic";

export type Dot = "green" | "amber" | "red" | "grey";
export type Piece = "ok" | "partial" | "missing" | "na" | "unknown";
export type DeliveryState = "found" | "draft" | "none" | "na" | "unknown";

export type ReadinessRow = {
  state: MarketState;
  price: Piece;
  priceNote: string;
  translation: Piece;
  translationNote: string;
  adaptation: "present" | "absent" | "na" | "unknown";
  delivery: DeliveryState;
  previewUrl: string;
  dot: Dot;
};

export type Data = { rows: ReadinessRow[]; notes: string[]; handle: string };

const FIELDS = ["title", "body_html", "meta_title", "meta_description"] as const;
const FIELD_NAME: Record<(typeof FIELDS)[number], string> = { title: "title", body_html: "description", meta_title: "SEO title", meta_description: "SEO description" };

const tr = (code: string) => `tr_${aliasOf(code)}`;
const ad = (code: string, marketId: string) => `ad_${aliasOf(code)}_${aliasOf(marketId.split("/").pop() ?? marketId)}`;

type Pair = { code: string; marketId: string };

export const translationsQuery = (codes: string[], pairs: Pair[]) => `query ReadinessTranslations($id: ID!) {
  translatableResource(resourceId: $id) {
    translatableContent { key value }
    ${codes.map((c) => `${tr(c)}: translations(locale: ${localeLiteral(c)}) { key value outdated }`).join("\n    ")}
    ${pairs.map((p) => `${ad(p.code, p.marketId)}: translations(locale: ${localeLiteral(p.code)}, marketId: ${gqlString(p.marketId)}) { key value }`).join("\n    ")}
  }
}`;

type TrRaw = ({ translatableContent: Content } & Record<string, unknown>) | null;

/** Title, description and SEO translated in the market's language. */
export function translationPiece(content: Content, translations: Translations): { piece: Piece; note: string } {
  const cells = FIELDS.map((k) => ({ k, cell: cellFor(content, translations, k) })).filter((x) => x.cell.status !== "none");
  if (cells.length === 0) return { piece: "na", note: "" };
  const bad = cells.filter((x) => x.cell.status !== "translated");
  if (bad.length === 0) return { piece: "ok", note: "" };
  const missing = bad.map((x) => FIELD_NAME[x.k]);
  return { piece: bad.length === cells.length && bad.every((x) => x.cell.status === "missing") ? "missing" : "partial", note: `Needs translation: ${missing.join(", ")}.` };
}

export function priceOf(price: MarketPrice | null): { piece: Piece; note: string } {
  if (!price || !price.low.price) return { piece: "missing", note: "No price in this market." };
  if (!(price.low.price.amount > 0)) return { piece: "missing", note: "The price is zero." };
  return { piece: "ok", note: "" };
}

export function deliveryState(records: RecordsFacts, facts: ProductFacts, s: BlockSettings): DeliveryState {
  if (!s.records.deliveryType) return "na";
  const keys = deliveryKeys(facts, s);
  if (keys.length === 0) return "na";
  if (records.state === "skipped") return "na";
  if (records.delivery === null) return "unknown";
  const hits = matchDelivery(records.delivery, keys);
  if (hits.some((h) => h.status === "ACTIVE" || h.status === null)) return "found";
  return hits.length ? "draft" : "none";
}

export function dotOf(r: Pick<ReadinessRow, "state" | "price" | "translation" | "delivery" | "adaptation">): Dot {
  if (r.state.state === "no-market") return "grey";
  if (r.state.state === "not-published" || r.price === "missing") return "red";
  if (r.translation === "partial" || r.translation === "missing" || r.delivery === "none" || r.delivery === "draft" || r.adaptation === "absent") return "amber";
  return "green";
}

export async function load(ctx: LoadContext): Promise<Data> {
  const { productId, q, soft } = ctx;
  const settings = settingsOf(ctx);
  const defs = marketDefs(settings);
  const notes: string[] = [];
  const woodFields = [
    { label: "Wood type", namespace: "custom", key: "product_wood_type", owner: "product" as const },
    { label: "Material title", namespace: "custom", key: "material-main-title", owner: "product" as const },
  ];
  const facts = await loadFacts(ctx, { publications: true, fields: woodFields });
  const codes = [...new Set(defs.map((d) => d.locale ?? "").filter(Boolean))];
  const states = await readMarketStates(soft, defs, facts.publishedCatalogIds);
  const marketRows = states ?? defs.map((def): MarketState => ({ def, marketId: null, marketName: null, marketStatus: null, state: "no-market" }));
  if (!states) notes.push("The market list could not be read.");

  const pairs: Pair[] = marketRows.flatMap((m) => (m.marketId && m.def.locale && settings.adaptations.some((a) => a.locale === m.def.locale && a.marketId === m.marketId) ? [{ code: m.def.locale, marketId: m.marketId }] : []));
  const [priced, trans, records] = await Promise.all([
    withPricing(q, productId, marketCountries(defs), (selection) => q<{ product: Record<string, unknown> | null }>(`query ReadinessPricing($id: ID!) { product(id: $id) { id ${selection} } }`, { id: productId })),
    codes.length ? soft<{ translatableResource: TrRaw }>(translationsQuery(codes, pairs), { id: productId }) : Promise.resolve(null),
    settings.records.deliveryType ? loadRecords(ctx, facts, settings, { linked: false, delivery: true }) : Promise.resolve({ state: "skipped" as const, message: "", linked: {}, delivery: null }),
  ]);
  if (priced.pricing.note) notes.push(priced.pricing.note);
  if (trans && !trans.data) notes.push(`Translations could not be read: ${trans.error?.message ?? "unknown error"}`);
  if (records.state === "failed") notes.push("Delivery-time records could not be read. They need the metaobject permission.");

  const resource = trans?.data?.translatableResource ?? null;
  const delivery = deliveryState(records, facts, settings);
  const rows = marketRows.map((state): ReadinessRow => {
    const price = priceOf(priced.pricing.prices[state.def.country] ?? null);
    const locale = state.def.locale ?? "";
    let translation: { piece: Piece; note: string } = { piece: "na", note: "" };
    if (locale && trans) translation = resource ? translationPiece(resource.translatableContent ?? [], (resource[tr(locale)] as Translations | undefined) ?? []) : { piece: "unknown", note: "" };
    let adaptation: ReadinessRow["adaptation"] = "na";
    if (state.marketId && locale && pairs.some((p) => p.code === locale && p.marketId === state.marketId)) {
      const list = (resource?.[ad(locale, state.marketId)] as Translations | undefined) ?? null;
      adaptation = !resource ? "unknown" : list && list.some((x) => (x.value ?? "").trim()) ? "present" : "absent";
    }
    const row = { state, price: price.piece, priceNote: price.note, translation: translation.piece, translationNote: translation.note, adaptation, delivery, previewUrl: storefrontUrl(state.def, facts.handle) };
    return { ...row, dot: dotOf(row) };
  });
  return { rows, notes, handle: facts.handle };
}
