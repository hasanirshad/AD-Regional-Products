// The state behind the standard search and filter bar. Every list page has one `ListUi` (filters, ticked rows, "Show only
// selected", page number). They live in the layout, so moving to another page and back loses nothing; a reload starts clean.
// The shared reads (collections, and the products of a chosen collection) live here too: read once, used by every page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liveGql, messageOf } from "../lib/editor/gql";
import { loadCollectionProducts, loadCollections, type CollectionChoice } from "../lib/editor/bulkLoad";
import { applyFilters, stockCandidates, type FilterContext } from "../lib/filters/applyFilters";
import { clearAll, countValues, needsCollections, needsStock, NO_FILTERS, STATUS_LABEL, type FilterState, type SectionId } from "../lib/filters/filterModel";
import { onlySelectedStays, visibleRows } from "../lib/filters/selection";
import type { Market, ProductRow } from "../lib/types";
import type { FilterOptions, PickOption } from "../components/filters/FilterPopup";
import { useLazy, type Lazy } from "./editor-state";

export type ListUi = {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  selected: Set<string>;
  setSelected: (update: (prev: Set<string>) => Set<string>) => void;
  /** "Show only selected": the table shows only the ticked rows and ignores search and filters. */
  onlySelected: boolean;
  setOnlySelected: (on: boolean) => void;
  clearSelection: () => void;
  /** Search and every filter off (ticks stay). */
  clearFilters: () => void;
  page: number;
  setPage: (n: number) => void;
};

export function useListUi(initial: FilterState = NO_FILTERS): ListUi {
  const [filters, setFiltersRaw] = useState<FilterState>(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlySelected, setOnlySelectedRaw] = useState(false);
  const [page, setPage] = useState(0);

  // Whatever empties the selection (a finished run, "Clear selection") also ends "Show only selected".
  const none = selected.size === 0;
  useEffect(() => {
    if (none) setOnlySelectedRaw(false);
  }, [none]);

  // Any change of filters or search goes back to page 1. Ticks are never touched by it.
  const setFilters = useCallback((f: FilterState) => {
    setFiltersRaw(f);
    setPage(0);
  }, []);
  const setOnlySelected = useCallback((on: boolean) => {
    setOnlySelectedRaw(on);
    setPage(0);
  }, []);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setOnlySelectedRaw(false);
    setPage(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersRaw(clearAll());
    setPage(0);
  }, []);

  return useMemo(
    () => ({ filters, setFilters, selected, setSelected, onlySelected, setOnlySelected, clearSelection, clearFilters, page, setPage }),
    [filters, setFilters, selected, onlySelected, setOnlySelected, clearSelection, clearFilters, page],
  );
}

// ---------------------------------------------------------------- collections

export type CollectionData = {
  /** The store's collections, read the first time a filter popup opens. */
  list: Lazy<CollectionChoice[]>;
  /** The product ids of every collection read so far. */
  members: Record<string, ReadonlySet<string>>;
  errors: Record<string, string>;
  /** Starts reading the products of these collections (the ones not read yet). Collections no longer wanted are skipped. */
  want: (ids: string[]) => void;
};

export function useCollectionData(): CollectionData {
  const list = useLazy(() => loadCollections(liveGql));
  const [members, setMembers] = useState<Record<string, ReadonlySet<string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const wanted = useRef<Set<string>>(new Set());
  const started = useRef<Set<string>>(new Set());
  const queue = useRef<string[]>([]);
  const running = useRef(false);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length > 0) {
        const id = queue.current.shift()!;
        // Filters changed again before this one started: do not read it.
        if (!wanted.current.has(id)) {
          started.current.delete(id);
          continue;
        }
        try {
          const ids = await loadCollectionProducts(liveGql, id);
          setMembers((m) => ({ ...m, [id]: ids }));
        } catch (e) {
          setErrors((x) => ({ ...x, [id]: messageOf(e) }));
          started.current.delete(id);
        }
      }
    } finally {
      running.current = false;
    }
  }, []);

  const want = useCallback(
    (ids: string[]) => {
      wanted.current = new Set(ids);
      for (const id of ids) {
        if (started.current.has(id)) continue;
        started.current.add(id);
        queue.current.push(id);
      }
      void pump();
    },
    [pump],
  );

  return useMemo(() => ({ list, members, errors, want }), [list, members, errors, want]);
}

// ---------------------------------------------------------------- one list

const byLabel = (a: PickOption, b: PickOption) => a.label.localeCompare(b.label);

/** Options built from the products: vendors, types, tags, catalogues (with counts) and markets. */
export function baseOptions(rows: ProductRow[], markets: Market[]): FilterOptions {
  const counts = countValues(rows);
  const pick = (m: Map<string, number>): PickOption[] => [...m.entries()].map(([value, count]) => ({ value, label: value, count })).sort(byLabel);
  const catalogs = new Map<string, string>();
  for (const p of rows) for (const c of p.catalogs) catalogs.set(c.id, c.title);
  return {
    vendor: pick(counts.vendor),
    productType: pick(counts.productType),
    tag: pick(counts.tag),
    catalog: [...catalogs.entries()].map(([value, label]) => ({ value, label, count: counts.catalog.get(value) ?? 0 })).sort(byLabel),
    market: markets.map((m) => ({ value: m.id, label: m.name })),
  };
}

export const marketCatalogsOf = (markets: Market[]): Record<string, string[]> => Object.fromEntries(markets.map((m) => [m.id, m.catalogs.map((c) => c.id)]));

export type ListFilterArgs<T extends ProductRow> = {
  rows: T[];
  ui: ListUi;
  markets: Market[];
  collections: CollectionData;
  /** What the sections need from this page: stock, translations, metafield values, page-only filters, extra search text. */
  context?: Omit<FilterContext<T>, "marketCatalogs" | "collections">;
  /** Choices a page adds (locations, languages, metafield definitions, "This page only" sections, notes). */
  options?: Partial<FilterOptions>;
  /** Languages of the store, for a translation filter that names none. */
  slots?: string[];
  sections: SectionId[];
  /** What a waiting product is waiting for ("their stock"). */
  waitingFor?: string;
};

export type ListFilterResult<T extends ProductRow> = {
  /** Rows that match the search and the filters. */
  matching: T[];
  /** Rows the table pages through: the ticked rows with "Show only selected", else `matching`. */
  list: T[];
  /** Products that cannot be judged yet (their stock, collection or values are still being read). */
  waiting: number;
  onlySelected: boolean;
  options: FilterOptions;
  /** The products whose stock must be read for the stock filters (empty when no stock filter is on). */
  candidates: T[];
  /** Lines for under the search box: products waiting for data, collections that could not be read. */
  notes: string[];
  /** Starts the reads only the popup needs (the collection list). Pass to the bar's `onOpen`. */
  onOpen: () => void;
};

/** Everything a list page needs from the filters, in one place. The page only declares its sections and how to read its rows. */
export function useListFilters<T extends ProductRow>({ rows, ui, markets, collections, context, options: extra, slots, sections, waitingFor }: ListFilterArgs<T>): ListFilterResult<T> {
  const { filters, selected } = ui;
  const wantCollections = sections.includes("collection");

  // The products of the chosen collections are read in the background, and not read again by another page.
  const chosen = filters.collection;
  useEffect(() => {
    if (wantCollections && needsCollections(filters)) collections.want(chosen);
  }, [wantCollections, chosen.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = useMemo(() => baseOptions(rows, markets), [rows, markets]);
  const marketCatalogs = useMemo(() => marketCatalogsOf(markets), [markets]);
  const collectionOptions = useMemo<PickOption[]>(() => (collections.list.data ?? []).map((c) => ({ value: c.id, label: c.title })), [collections.list.data]);

  const options = useMemo<FilterOptions>(
    () => ({ ...base, collection: collectionOptions, collectionState: collections.list.status, collectionError: collections.list.error, ...extra }),
    [base, collectionOptions, collections.list.status, collections.list.error, extra],
  );

  const ctx = useMemo<FilterContext<T>>(() => ({ ...context, marketCatalogs, collections: collections.members }), [context, marketCatalogs, collections.members]);
  const result = useMemo(() => applyFilters(rows, filters, ctx, slots), [rows, filters, ctx, slots]);

  const candidates = useMemo(() => (needsStock(filters) ? stockCandidates(rows, filters, ctx, slots) : []), [rows, filters, ctx, slots]);
  const onlySelected = onlySelectedStays(selected, ui.onlySelected);
  const list = useMemo(() => (onlySelected ? visibleRows(rows, result.rows, selected, true) : result.rows), [onlySelected, rows, result.rows, selected]);
  const onOpen = useCallback(() => {
    if (wantCollections) collections.list.load();
  }, [wantCollections, collections.list.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = useMemo(() => Object.fromEntries(collectionOptions.map((o) => [o.value, o.label])), [collectionOptions]);
  const notes = useMemo(
    () => listNotes({ waiting: wantCollections && filters.collection.length > 0 && Object.keys(collections.errors).length > 0 ? 0 : result.waiting, waitingFor: waitingFor ?? "data still being read", collectionErrors: filters.collection.filter((c) => collections.errors[c]).map((c) => `Could not read the collection ${names[c] ?? ""}: ${collections.errors[c]}`) }),
    [result.waiting, waitingFor, filters.collection, collections.errors, names, wantCollections],
  );

  return { matching: result.rows, list, waiting: result.waiting, onlySelected, options, candidates, notes, onOpen };
}

export const statusOptions = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));

/** Notes for the lines under the search box. */
export function listNotes(parts: { loadingProducts?: number; waiting?: number; waitingFor?: string; collectionErrors?: string[] }): string[] {
  const out: string[] = [];
  if (parts.loadingProducts && parts.loadingProducts > 0) out.push(`${parts.loadingProducts} product${parts.loadingProducts === 1 ? "" : "s"} still loading`);
  if (parts.waiting && parts.waiting > 0) out.push(`${parts.waiting} product${parts.waiting === 1 ? " is" : "s are"} waiting for ${parts.waitingFor ?? "their data"}`);
  for (const e of parts.collectionErrors ?? []) out.push(e);
  return out;
}
