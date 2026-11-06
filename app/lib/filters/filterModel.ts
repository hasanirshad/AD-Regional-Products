// The one filter state every list in the app uses (search + the Filters popup), its defaults, how many filters are on,
// and the removable chips that describe them. Pure: no React, no network.
//
// Rules shared by the three APPSDAPPS apps:
//  - different sections must ALL match (AND);
//  - several values inside one section: any of them, unless the section has the any/all choice (Tag, has);
//  - "Tag, does not have" and "Not in" always mean none of the chosen.

/** A special value in a catalogue or location list: "in no catalogue", "in any catalogue", "stocked nowhere". */
export const NONE = "__none__";
export const ANY = "__any__";

export type Match = "any" | "all";
export type Availability = "available" | "soldout" | "partly";
export type Tracking = "all" | "none" | "some";
export type TranslationMode = "" | "missing" | "outdated" | "complete";
export type MetafieldState = "" | "empty" | "filled";

export type FilterState = {
  search: string;
  /** ACTIVE, DRAFT, ARCHIVED. */
  status: string[];
  vendor: string[];
  productType: string[];
  /** Collection ids. */
  collection: string[];
  tag: string[];
  /** How several chosen tags combine in "Tag, has". */
  tagMatch: Match;
  /** "Tag, does not have": a product is kept only when it has none of these. */
  tagNot: string[];
  /** Market catalogue, "in": catalogue ids, or NONE (in no catalogue) / ANY (in some catalogue). */
  catalogIn: string[];
  /** Market catalogue, "not in": none of these. */
  catalogNot: string[];
  /** Published in market: market ids. */
  market: string[];
  availability: Availability[];
  tracked: Tracking[];
  /** Stocked at: location ids, or NONE (stocked nowhere). */
  locations: string[];
  min: string;
  max: string;
  translationMode: TranslationMode;
  /** Language slots the translation filter looks at. Empty = every language. */
  translationSlots: string[];
  /** A metafield definition key ("namespace.key"), or "". */
  metafield: string;
  metafieldState: MetafieldState;
  /** "This page only": values per page-specific filter, by the key the page gave it. */
  page: Record<string, string[]>;
};

export const NO_FILTERS: FilterState = {
  search: "",
  status: [],
  vendor: [],
  productType: [],
  collection: [],
  tag: [],
  tagMatch: "any",
  tagNot: [],
  catalogIn: [],
  catalogNot: [],
  market: [],
  availability: [],
  tracked: [],
  locations: [],
  min: "",
  max: "",
  translationMode: "",
  translationSlots: [],
  metafield: "",
  metafieldState: "",
  page: {},
};

/** The sections of the popup, in the order they are always shown. A page declares which of them it uses. */
export const SECTION_ORDER = [
  "status",
  "vendor",
  "productType",
  "collection",
  "tag",
  "tagNot",
  "catalog",
  "market",
  "stock",
  "variants",
  "price",
  "translations",
  "metafield",
  "page",
] as const;
export type SectionId = (typeof SECTION_ORDER)[number];

/** The labels, the same on every page of every app. */
export const SECTION_LABEL: Record<SectionId, string> = {
  status: "Status",
  vendor: "Vendor",
  productType: "Product type",
  collection: "Collection",
  tag: "Tag, has",
  tagNot: "Tag, does not have",
  catalog: "Market catalogue",
  market: "Published in market",
  stock: "Stock",
  variants: "Number of variants",
  price: "Price",
  translations: "Translations",
  metafield: "Metafield",
  page: "This page only",
};

export const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };
const AVAILABILITY_LABEL: Record<Availability, string> = { available: "Available", soldout: "Sold out", partly: "Partly sold out" };
const TRACKING_LABEL: Record<Tracking, string> = { all: "Tracked", none: "Not tracked", some: "Partly tracked" };

/** A filter section for something only this page has. `options` are the choices; values are ticked (any of them). */
export type PageSection = { key: string; label: string; options: { value: string; label: string }[]; /** Show as a dropdown (one value) instead of tick boxes. */ single?: boolean };

/** Names for ids, so chips read "Catalogue: UK" and not a gid. */
export type FilterNames = {
  catalogs?: Record<string, string>;
  collections?: Record<string, string>;
  markets?: Record<string, string>;
  locations?: Record<string, string>;
  slots?: Record<string, string>;
  metafields?: Record<string, string>;
  /** Page-only sections, by key. */
  pageSections?: PageSection[];
};

export type FilterChip = { key: string; label: string; remove: (f: FilterState) => FilterState };

const without = <T,>(list: T[], value: T): T[] => list.filter((x) => x !== value);
const lower = (s: string) => s.toLowerCase();

export const isWhole = (text: string): boolean => text.trim() === "" || /^\d+$/.test(text.trim());
const whole = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
export const variantRange = (f: FilterState): { min: number | null; max: number | null } => ({ min: whole(f.min), max: whole(f.max) });

/** One removable chip per chosen value. Nothing for the search text (it has its own box). */
export function describeChips(f: FilterState, names: FilterNames = {}): FilterChip[] {
  const chips: FilterChip[] = [];
  const list = <K extends keyof FilterState>(field: K, values: string[], label: (v: string) => string) => {
    for (const v of values) chips.push({ key: `${String(field)}:${v}`, label: label(v), remove: (x) => ({ ...x, [field]: without(x[field] as string[], v) }) });
  };
  list("status", f.status, (v) => `Status: ${lower(STATUS_LABEL[v] ?? v)}`);
  list("vendor", f.vendor, (v) => `Vendor: ${v}`);
  list("productType", f.productType, (v) => `Product type: ${v}`);
  list("collection", f.collection, (v) => `Collection: ${names.collections?.[v] ?? "unknown"}`);
  list("tag", f.tag, (v) => `Tag: ${v}`);
  list("tagNot", f.tagNot, (v) => `Tag excluded: ${v}`);
  list("catalogIn", f.catalogIn, (v) => (v === NONE ? "In no catalogue" : v === ANY ? "In a catalogue" : `Catalogue: ${names.catalogs?.[v] ?? "unknown"}`));
  list("catalogNot", f.catalogNot, (v) => (v === ANY ? "Not in a catalogue" : `Not in catalogue: ${names.catalogs?.[v] ?? "unknown"}`));
  list("market", f.market, (v) => `Published in market: ${names.markets?.[v] ?? "unknown"}`);
  list("availability", f.availability, (v) => `Stock: ${lower(AVAILABILITY_LABEL[v as Availability] ?? v)}`);
  list("tracked", f.tracked, (v) => `Stock: ${lower(TRACKING_LABEL[v as Tracking] ?? v)}`);
  list("locations", f.locations, (v) => (v === NONE ? "Stocked nowhere" : `Stocked at: ${names.locations?.[v] ?? "unknown"}`));
  if (f.min.trim() || f.max.trim()) {
    const min = f.min.trim();
    const max = f.max.trim();
    const label = min && max ? `Variants: ${min} to ${max}` : min ? `Variants: ${min} or more` : `Variants: up to ${max}`;
    chips.push({ key: "variants", label, remove: (x) => ({ ...x, min: "", max: "" }) });
  }
  if (f.translationMode) {
    const what = f.translationMode === "missing" ? "missing" : f.translationMode === "outdated" ? "outdated" : "complete";
    if (f.translationSlots.length === 0) chips.push({ key: "translation", label: `Translation ${what}`, remove: (x) => ({ ...x, translationMode: "", translationSlots: [] }) });
    else
      for (const s of f.translationSlots)
        chips.push({
          key: `translation:${s}`,
          label: `Translation ${what}: ${names.slots?.[s] ?? s}`,
          remove: (x) => {
            const slots = without(x.translationSlots, s);
            // The last language removed leaves "any language", so the chip would not vanish: remove the whole filter.
            return slots.length === 0 ? { ...x, translationMode: "", translationSlots: [] } : { ...x, translationSlots: slots };
          },
        });
  }
  if (f.metafield && f.metafieldState) {
    const state = f.metafieldState === "empty" ? "is empty" : "has a value";
    chips.push({ key: "metafield", label: `Metafield: ${names.metafields?.[f.metafield] ?? f.metafield} ${state}`, remove: (x) => ({ ...x, metafield: "", metafieldState: "" }) });
  }
  for (const [key, values] of Object.entries(f.page)) {
    const section = names.pageSections?.find((s) => s.key === key);
    for (const v of values) {
      const label = `${section?.label ?? key}: ${section?.options.find((o) => o.value === v)?.label ?? v}`;
      chips.push({
        key: `page:${key}:${v}`,
        label,
        remove: (x) => {
          const left = without(x.page[key] ?? [], v);
          const page = { ...x.page };
          if (left.length === 0) delete page[key];
          else page[key] = left;
          return { ...x, page };
        },
      });
    }
  }
  return chips;
}

/** How many filters are on: one per chip (the search text does not count). */
export const countActive = (f: FilterState): number => describeChips(f).length;

/** True when anything at all narrows the list, search included. */
export const isFiltering = (f: FilterState): boolean => f.search.trim() !== "" || countActive(f) > 0;

/** Back to nothing chosen, search included. */
export const clearAll = (): FilterState => ({ ...NO_FILTERS, page: {} });

/** Several filter values on one row of the popup: a value picked once is not added twice. */
export const addValue = (list: string[], value: string): string[] => (list.includes(value) ? list : [...list, value]);

/** True when the filters need data that is read in the background. */
export const needsStock = (f: FilterState): boolean => f.availability.length > 0 || f.tracked.length > 0 || f.locations.length > 0;
export const needsValues = (f: FilterState): boolean => f.translationMode !== "" || (f.metafield !== "" && f.metafieldState !== "");
export const needsCollections = (f: FilterState): boolean => f.collection.length > 0;

/** How many products each value of a list has (for "tag (12)" in the lists). */
export function countValues<T extends { status: string; vendor: string; productType: string; tags: string[]; catalogs: { id: string }[] }>(rows: T[]) {
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
