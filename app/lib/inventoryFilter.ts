// Filters of the Inventory page: several values per filter, plus filters that need the stock of each product
// (availability, tracking, stock location). Pure functions, no network.

import { ANY, applyFilters, NO_FILTERS, NONE } from "./filter";
import type { StockSummary } from "./inventory";
import type { ProductRow } from "./types";

export type Availability = "available" | "soldout" | "partly";
export type Tracking = "all" | "none" | "some";

export type InvFilters = {
  search: string;
  status: string[];
  vendor: string[];
  productType: string[];
  tag: string[];
  /** Catalogue ids, or NONE (in no catalogue). */
  catalog: string[];
  min: string;
  max: string;
  availability: Availability[];
  tracked: Tracking[];
  /** Location ids, or NONE (stocked nowhere). */
  locations: string[];
};

export const NO_INV_FILTERS: InvFilters = {
  search: "",
  status: [],
  vendor: [],
  productType: [],
  tag: [],
  catalog: [],
  min: "",
  max: "",
  availability: [],
  tracked: [],
  locations: [],
};

/** True when a filter needs the stock of each product (read from Shopify, product by product). */
export const stockNeeded = (f: InvFilters): boolean => f.availability.length > 0 || f.tracked.length > 0 || f.locations.length > 0;

export function availabilityOf(s: StockSummary): Availability {
  return s.soldOut === 0 ? "available" : s.soldOut >= s.variants ? "soldout" : "partly";
}

export function trackingOf(s: StockSummary): Tracking {
  return s.tracked === s.variants ? "all" : s.tracked === 0 ? "none" : "some";
}

const num = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/** The filters that need no stock: search, status, vendor, type, tag, catalogue, number of variants. */
export function applyBaseFilters(rows: ProductRow[], f: InvFilters): ProductRow[] {
  const found = f.search.trim() ? applyFilters(rows, { ...NO_FILTERS, search: f.search }, {}) : rows;
  const min = num(f.min);
  const max = num(f.max);
  return found.filter((p) => {
    if (f.status.length && !f.status.includes(p.status)) return false;
    if (f.vendor.length && !f.vendor.includes(p.vendor)) return false;
    if (f.productType.length && !f.productType.includes(p.productType)) return false;
    if (f.tag.length && !f.tag.some((t) => p.tags.includes(t))) return false;
    if (f.catalog.length) {
      const hit = f.catalog.some((c) => (c === NONE ? p.catalogs.length === 0 : c === ANY ? p.catalogs.length > 0 : p.catalogs.some((x) => x.id === c)));
      if (!hit) return false;
    }
    if (min !== null && p.variantCount < min) return false;
    if (max !== null && p.variantCount > max) return false;
    return true;
  });
}

/**
 * Applies the filters that need stock. A product whose stock has not been read yet cannot be judged: it is left out
 * and counted in `waiting`, so the page can say the list is still filling.
 */
export function applyStockFilters(rows: ProductRow[], f: InvFilters, summaries: Record<string, StockSummary>): { rows: ProductRow[]; waiting: number } {
  if (!stockNeeded(f)) return { rows, waiting: 0 };
  let waiting = 0;
  const out = rows.filter((p) => {
    const s = summaries[p.id];
    if (!s) {
      waiting++;
      return false;
    }
    if (f.availability.length && !f.availability.includes(availabilityOf(s))) return false;
    if (f.tracked.length && !f.tracked.includes(trackingOf(s))) return false;
    if (f.locations.length) {
      const hit = f.locations.some((l) => (l === NONE ? s.locations.length === 0 : s.locations.some((x) => x.id === l)));
      if (!hit) return false;
    }
    return true;
  });
  return { rows: out, waiting };
}

/** How many products each value of a filter has (for "tag (12)" in the lists). */
export function countValues(rows: ProductRow[]) {
  const count = (values: string[]) => {
    const m = new Map<string, number>();
    for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  };
  const catalogs = new Map<string, number>();
  for (const p of rows) for (const c of p.catalogs) catalogs.set(c.id, (catalogs.get(c.id) ?? 0) + 1);
  return {
    status: count(rows.map((p) => p.status)),
    vendor: count(rows.map((p) => p.vendor)),
    productType: count(rows.map((p) => p.productType)),
    tag: count(rows.flatMap((p) => p.tags)),
    catalog: catalogs,
  };
}

export type InvChip = { key: string; label: string; remove: (f: InvFilters) => InvFilters };

const without = <T,>(list: T[], value: T) => list.filter((x) => x !== value);

const AVAILABILITY_LABEL: Record<Availability, string> = { available: "Available", soldout: "Sold out", partly: "Partly sold out" };
const TRACKING_LABEL: Record<Tracking, string> = { all: "Tracked", none: "Not tracked", some: "Partly tracked" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };

/** One removable chip per chosen value. */
export function activeInvChips(f: InvFilters, names: { catalogs: Record<string, string>; locations: Record<string, string> }): InvChip[] {
  const chips: InvChip[] = [];
  for (const v of f.status) chips.push({ key: `status:${v}`, label: `Status: ${STATUS_LABEL[v] ?? v}`, remove: (x) => ({ ...x, status: without(x.status, v) }) });
  for (const v of f.vendor) chips.push({ key: `vendor:${v}`, label: `Vendor: ${v}`, remove: (x) => ({ ...x, vendor: without(x.vendor, v) }) });
  for (const v of f.productType) chips.push({ key: `type:${v}`, label: `Type: ${v}`, remove: (x) => ({ ...x, productType: without(x.productType, v) }) });
  for (const v of f.tag) chips.push({ key: `tag:${v}`, label: `Tag: ${v}`, remove: (x) => ({ ...x, tag: without(x.tag, v) }) });
  for (const v of f.catalog) {
    const label = v === NONE ? "In no catalogue" : v === ANY ? "In any catalogue" : `Catalogue: ${names.catalogs[v] ?? "unknown"}`;
    chips.push({ key: `catalog:${v}`, label, remove: (x) => ({ ...x, catalog: without(x.catalog, v) }) });
  }
  if (f.min || f.max) {
    const label = f.min && f.max ? `Variants: ${f.min} to ${f.max}` : f.min ? `Variants: ${f.min} or more` : `Variants: up to ${f.max}`;
    chips.push({ key: "variants", label, remove: (x) => ({ ...x, min: "", max: "" }) });
  }
  for (const v of f.availability) chips.push({ key: `availability:${v}`, label: AVAILABILITY_LABEL[v], remove: (x) => ({ ...x, availability: without(x.availability, v) }) });
  for (const v of f.tracked) chips.push({ key: `tracked:${v}`, label: TRACKING_LABEL[v], remove: (x) => ({ ...x, tracked: without(x.tracked, v) }) });
  for (const v of f.locations) {
    const label = v === NONE ? "Stocked nowhere" : `Stocked at ${names.locations[v] ?? "unknown"}`;
    chips.push({ key: `location:${v}`, label, remove: (x) => ({ ...x, locations: without(x.locations, v) }) });
  }
  return chips;
}
