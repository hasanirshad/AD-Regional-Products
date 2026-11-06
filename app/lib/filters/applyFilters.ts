// The filters and the search applied to a list of products. Pure.
//
// A filter that needs data that is not read yet (stock, collection members, translations, metafield values) cannot judge a
// product: that product is not shown and is counted in `waiting`, so the page can say the list is still filling.
// A product that already fails a filter that CAN be judged is dropped, not counted: it would not show up anyway.

import type { StockSummary } from "../inventory";
import type { ProductRow } from "../types";
import { ANY, NONE, variantRange, type Availability, type FilterState, type Match, type Tracking } from "./filterModel";
import { matchesWords, rowText, searchWords } from "./searchText";

/** A translation judged for one language: has the product a missing, an outdated or only complete texts? undefined = not read yet. */
export type TranslationState = "missing" | "outdated" | "complete" | undefined;

export type FilterContext<T extends ProductRow = ProductRow> = {
  /** Market id -> the ids of its catalogues (for "Published in market"). */
  marketCatalogs?: Record<string, string[]>;
  /** Collection id -> the product ids read for it. A collection that is missing here is still being read. */
  collections?: Record<string, ReadonlySet<string>>;
  /** Product id -> its stock summary (undefined = not read yet). */
  stock?: Record<string, StockSummary>;
  /** The state of the translations of a product in one language. */
  translation?: (row: T, slot: string) => TranslationState;
  /** Is the product metafield `def` empty? undefined = not read yet. */
  metafieldEmpty?: (row: T, def: string) => boolean | undefined;
  /** The "This page only" filters: does the row match them? Called once per row, with every page filter that has a value (keys with several values: any of them). */
  pageMatch?: (row: T, page: Record<string, string[]>) => boolean;
  /** Extra search text for a row (SKU, the cell texts of the columns the table shows). */
  searchColumns?: (row: T) => readonly string[];
};

export type Filtered<T> = { rows: T[]; waiting: number };

const test = <V,>(values: V[], mode: Match, has: (v: V) => boolean): boolean => (mode === "all" ? values.every(has) : values.some(has));

export function availabilityOf(s: StockSummary): Availability {
  return s.soldOut === 0 ? "available" : s.soldOut >= s.variants ? "soldout" : "partly";
}

export function trackingOf(s: StockSummary): Tracking {
  return s.tracked === s.variants ? "all" : s.tracked === 0 ? "none" : "some";
}

const inCatalog = (p: ProductRow, c: string): boolean => (c === NONE ? p.catalogs.length === 0 : c === ANY ? p.catalogs.length > 0 : p.catalogs.some((x) => x.id === c));

/** Everything that can be judged from the product list alone (no background data): search, status, vendor, type, tags, catalogues, markets, variants, page filters. */
export function matchesBase<T extends ProductRow>(p: T, f: FilterState, ctx: FilterContext<T>, words: readonly string[]): boolean {
  if (words.length > 0 && !matchesWords(rowText(p, ctx.searchColumns ? ctx.searchColumns(p) : []), words)) return false;
  if (f.status.length && !f.status.includes(p.status)) return false;
  if (f.vendor.length && !f.vendor.includes(p.vendor)) return false;
  if (f.productType.length && !f.productType.includes(p.productType)) return false;
  if (f.tag.length && !test(f.tag, f.tagMatch, (t) => p.tags.includes(t))) return false;
  if (f.tagNot.length && f.tagNot.some((t) => p.tags.includes(t))) return false;
  if (f.catalogIn.length && !f.catalogIn.some((c) => inCatalog(p, c))) return false;
  // "Not in" always means none of the chosen.
  if (f.catalogNot.length && f.catalogNot.some((c) => inCatalog(p, c))) return false;
  if (f.market.length) {
    const hit = f.market.some((m) => (ctx.marketCatalogs?.[m] ?? []).some((c) => p.catalogs.some((x) => x.id === c)));
    if (!hit) return false;
  }
  const { min, max } = variantRange(f);
  if (min !== null && p.variantCount < min) return false;
  if (max !== null && p.variantCount > max) return false;
  if (ctx.pageMatch && Object.values(f.page).some((v) => v.length > 0) && !ctx.pageMatch(p, f.page)) return false;
  return true;
}

type Verdict = true | false | undefined;

function stockVerdict<T extends ProductRow>(p: T, f: FilterState, ctx: FilterContext<T>): Verdict {
  if (!(f.availability.length || f.tracked.length || f.locations.length)) return true;
  const s = ctx.stock?.[p.id];
  if (!s) return undefined;
  if (f.availability.length && !f.availability.includes(availabilityOf(s))) return false;
  if (f.tracked.length && !f.tracked.includes(trackingOf(s))) return false;
  if (f.locations.length && !f.locations.some((l) => (l === NONE ? s.locations.length === 0 : s.locations.some((x) => x.id === l)))) return false;
  return true;
}

function collectionVerdict<T extends ProductRow>(p: T, f: FilterState, ctx: FilterContext<T>): Verdict {
  if (!f.collection.length) return true;
  let unknown = false;
  for (const c of f.collection) {
    const members = ctx.collections?.[c];
    if (!members) unknown = true;
    else if (members.has(p.id)) return true;
  }
  return unknown ? undefined : false;
}

function translationVerdict<T extends ProductRow>(p: T, f: FilterState, ctx: FilterContext<T>, slots: readonly string[]): Verdict {
  if (!f.translationMode) return true;
  const chosen = f.translationSlots.length ? f.translationSlots : slots;
  if (chosen.length === 0 || !ctx.translation) return undefined;
  let unknown = false;
  for (const s of chosen) {
    const state = ctx.translation(p, s);
    if (state === undefined) unknown = true;
    else if (state === f.translationMode) return true;
  }
  return unknown ? undefined : false;
}

function metafieldVerdict<T extends ProductRow>(p: T, f: FilterState, ctx: FilterContext<T>): Verdict {
  if (!f.metafield || !f.metafieldState) return true;
  const empty = ctx.metafieldEmpty?.(p, f.metafield);
  if (empty === undefined) return undefined;
  return f.metafieldState === "empty" ? empty : !empty;
}

/**
 * Applies the search and every section. Sections combine with AND; values inside one section with "any" (tags may be "all").
 * `slots` are the languages of the store, for a translation filter that names none.
 */
export function applyFilters<T extends ProductRow>(rows: T[], f: FilterState, ctx: FilterContext<T> = {}, slots: readonly string[] = []): Filtered<T> {
  const words = searchWords(f.search);
  const out: T[] = [];
  let waiting = 0;
  for (const p of rows) {
    if (!matchesBase(p, f, ctx, words)) continue;
    const verdicts = [stockVerdict(p, f, ctx), collectionVerdict(p, f, ctx), translationVerdict(p, f, ctx, slots), metafieldVerdict(p, f, ctx)];
    if (verdicts.includes(false)) continue;
    if (verdicts.includes(undefined)) waiting++;
    else out.push(p);
  }
  return { rows: out, waiting };
}

/** Just the part that needs no background data. Used to decide which products to read stock, collection members and values for. */
export function applyBase<T extends ProductRow>(rows: T[], f: FilterState, ctx: FilterContext<T> = {}): T[] {
  const words = searchWords(f.search);
  return rows.filter((p) => matchesBase(p, f, ctx, words));
}

/**
 * The products whose stock still has to be read for the stock filters: those no other filter has already rejected.
 * (A product that fails the search, a tag or a collection will not show anyway, so its stock is not read.)
 */
export function stockCandidates<T extends ProductRow>(rows: T[], f: FilterState, ctx: FilterContext<T> = {}, slots: readonly string[] = []): T[] {
  const words = searchWords(f.search);
  return rows.filter((p) => matchesBase(p, f, ctx, words) && collectionVerdict(p, f, ctx) !== false && translationVerdict(p, f, ctx, slots) !== false && metafieldVerdict(p, f, ctx) !== false);
}

/**
 * First stage for lists that read values in the background (Bulk edit): the search, the sections that need only the product list,
 * and the collection. Translations, metafield values and stock are left to later stages. Products of a collection that is still
 * being read are not shown and are counted in `waiting`.
 */
export function applyListFilters<T extends ProductRow>(rows: T[], f: FilterState, ctx: FilterContext<T> = {}): Filtered<T> {
  const words = searchWords(f.search);
  const out: T[] = [];
  let waiting = 0;
  for (const p of rows) {
    if (!matchesBase(p, f, ctx, words)) continue;
    const v = collectionVerdict(p, f, ctx);
    if (v === false) continue;
    if (v === undefined) waiting++;
    else out.push(p);
  }
  return { rows: out, waiting };
}

/** Second stage: the translation and metafield filters, which need values read from Shopify. Products not read yet wait. */
export function applyValueFilters<T extends ProductRow>(rows: T[], f: FilterState, ctx: FilterContext<T> = {}, slots: readonly string[] = []): Filtered<T> {
  if (!f.translationMode && !(f.metafield && f.metafieldState)) return { rows, waiting: 0 };
  const out: T[] = [];
  let waiting = 0;
  for (const p of rows) {
    const verdicts = [translationVerdict(p, f, ctx, slots), metafieldVerdict(p, f, ctx)];
    if (verdicts.includes(false)) continue;
    if (verdicts.includes(undefined)) waiting++;
    else out.push(p);
  }
  return { rows: out, waiting };
}
