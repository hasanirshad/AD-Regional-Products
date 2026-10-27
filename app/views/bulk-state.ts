// Bulk edit's working state: the columns chosen, the filters, the sort, what has been read from Shopify, and what has
// been typed but not saved. It lives in the layout so leaving the page and coming back loses nothing.
//
// Reading: the first products are read quickly (a "quick subset"); "Load all" reads the rest, with a Stop button.
// Values are cached by target, so changing a filter or a sort never reads the same thing twice.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildChanges, type BuiltChanges, type ChangeContext } from "../lib/editor/changes";
import {
  NO_BULK_FILTERS,
  applyListFilters,
  applyValueFilters,
  cellText,
  filterColumns,
  listText,
  parseCell,
  productColumn,
  sortRows,
  targetOf,
  type BulkFilters,
  type Column,
  type Sort,
} from "../lib/editor/bulk";
import { loadCells, loadCollectionProducts, loadCollections, newCache, type Cache, type CollectionChoice } from "../lib/editor/bulkLoad";
import { editCount, effective, putEdit, removeEdits, type EditMap } from "../lib/editor/edits";
import { liveGql, messageOf } from "../lib/editor/gql";
import { defKey } from "../lib/editor/load";
import { targetKey, type Target, type Value } from "../lib/editor/model";
import type { ProductRow } from "../lib/types";
import type { EditorShared, Lazy } from "./editor-state";
import { useLazy } from "./editor-state";
import type { ProductsLoad } from "./products-state";

/** Products read before "Load all". */
export const QUICK = 100;
export const PAGE_SIZE = 25;

export type BulkState = {
  columns: Column[];
  setColumns: (c: Column[]) => void;
  filters: BulkFilters;
  setFilters: (f: BulkFilters) => void;
  sort: Sort | null;
  setSort: (s: Sort | null) => void;
  page: number;
  setPage: (n: number) => void;

  collections: Lazy<CollectionChoice[]>;
  collectionError: string;

  /** Rows after the filters and the sort: what the table pages through. */
  rows: ProductRow[];
  /** All products that match the list filters (before the quick subset). */
  inScope: number;
  /** Products read so far / waiting to be read for the filters that need values. */
  waiting: number;
  loadedCount: number;
  all: boolean;
  loadAll: () => void;
  progress: { busy: boolean; done: number; total: number; error: string };
  stop: () => void;

  cellValue: (col: Column, productId: string) => Value | undefined;
  /** The text in a cell: what was typed, or the value. */
  textOf: (col: Column, productId: string) => string;
  /** The variant a price cell edits, once it has been read. */
  cellVariant: (productId: string) => string | null;
  /** True when this cell has been read. */
  isLoaded: (col: Column, productId: string) => boolean;
  /** True when the product has no single variant (a price cannot be edited in the table). */
  noVariant: (col: Column, productId: string) => boolean;
  setCell: (col: Column, productId: string, text: string) => void;

  edits: EditMap;
  built: BuiltChanges;
  ctx: ChangeContext;
  discard: (keys: string[]) => void;
  discardAll: () => void;
  /** After a save: forget what was read for these changes so the table shows what Shopify has now. */
  reread: (keys: string[]) => void;
  /** Reads (if needed) the products a paste refers to, then resolves. */
  ensureProducts: (ids: string[], cols: Column[]) => Promise<void>;
};

export function useBulkState(shared: EditorShared, products: ProductsLoad): BulkState {
  const [columns, setColumns] = useState<Column[]>([productColumn("title"), productColumn("tags")]);
  const [filters, setFiltersRaw] = useState<BulkFilters>(NO_BULK_FILTERS);
  const [sort, setSort] = useState<Sort | null>(null);
  const [page, setPage] = useState(0);
  const [all, setAll] = useState(false);
  const [edits, setEdits] = useState<EditMap>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [progress, setProgress] = useState({ busy: false, done: 0, total: 0, error: "" });
  const cache = useRef<Cache>(newCache());
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const setFilters = useCallback((f: BulkFilters) => {
    setFiltersRaw(f);
    setPage(0);
  }, []);

  // ---- collections (read when the filter is first used)
  const collections = useLazy(() => loadCollections(liveGql));
  const [collectionIds, setCollectionIds] = useState<{ id: string; ids: Set<string> } | null>(null);
  const [collectionError, setCollectionError] = useState("");
  useEffect(() => {
    if (!filters.collection) {
      setCollectionError("");
      return;
    }
    if (collectionIds?.id === filters.collection) return;
    let cancelled = false;
    setCollectionError("");
    loadCollectionProducts(liveGql, filters.collection)
      .then((ids) => !cancelled && setCollectionIds({ id: filters.collection, ids }))
      .catch((e) => !cancelled && setCollectionError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [filters.collection, collectionIds?.id]);

  // ---- which rows, and which values they need
  const defs = shared.productDefs.data ?? [];
  const needed = useMemo(() => {
    const byId = new Map<string, Column>();
    for (const c of [...columns, ...filterColumns(filters, defs)]) byId.set(c.id, c);
    return [...byId.values()];
  }, [columns, filters, defs]);

  const listFiltered = useMemo(() => {
    const ids = filters.collection && collectionIds?.id === filters.collection ? collectionIds.ids : null;
    // While the collection is still being read nothing is shown, rather than every product.
    if (filters.collection && !ids) return [];
    return applyListFilters(products.rows, filters, ids);
  }, [products.rows, filters, collectionIds]);

  // Sorting by a column that comes with the list is free and decides which products are read first.
  const listSorted = useMemo(() => {
    const field = sort?.column.startsWith("p:") ? sort.column.slice(2) : null;
    if (!sort || !field || listText({ title: "" } as ProductRow, field) === null) return listFiltered;
    return sortRows(listFiltered, sort, (r) => listText(r, field) ?? "");
  }, [listFiltered, sort]);

  const subset = useMemo(() => (all ? listSorted : listSorted.slice(0, QUICK)), [listSorted, all]);
  const subsetKey = useMemo(() => subset.map((r) => r.id).join(","), [subset]);
  const neededKey = needed.map((c) => c.id).join("|");

  // ---- reading (latest request wins)
  const desired = useRef<{ ids: string[]; cols: Column[] } | null>(null);
  const running = useRef(false);
  const stopFlag = useRef(false);
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (desired.current) {
        const d = desired.current;
        desired.current = null;
        stopFlag.current = false;
        setProgress({ busy: true, done: 0, total: d.ids.length, error: "" });
        try {
          await loadCells(liveGql, d.ids, d.cols, cache.current, {
            onProgress: (done, total) => {
              setProgress({ busy: true, done, total, error: "" });
              bump();
            },
            shouldStop: () => stopFlag.current || desired.current !== null,
          });
          setProgress((p) => ({ ...p, busy: false }));
        } catch (e) {
          setProgress({ busy: false, done: 0, total: 0, error: messageOf(e) });
        }
        bump();
      }
    } finally {
      running.current = false;
    }
  }, [bump]);

  useEffect(() => {
    if (products.status !== "ready" || subset.length === 0) return;
    const timer = setTimeout(() => {
      desired.current = { ids: subset.map((r) => r.id), cols: needed };
      void pump();
    }, 250);
    return () => clearTimeout(timer);
  }, [subsetKey, neededKey, products.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    desired.current = null;
    stopFlag.current = true;
  }, []);

  const loadAll = useCallback(() => setAll(true), []);

  // ---- values
  const valueAt = useCallback((t: Target): Value | undefined => cache.current.values.get(targetKey(t)), [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueFiltered = useMemo(() => applyValueFilters(subset, filters, defs, (id, t) => cache.current.values.get(targetKey(t))), [subset, filters, defs, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const field = sort?.column;
    if (!sort || !field || field.startsWith("p:") && listText({ title: "" } as ProductRow, field.slice(2)) !== null) return valueFiltered.rows;
    const col = needed.find((c) => c.id === field);
    if (!col) return valueFiltered.rows;
    return sortRows(valueFiltered.rows, sort, (r) => {
      const t = targetOf(col, r.id, cache.current.variantIds.get(r.id) ?? null);
      return t ? cellText(col, edits[targetKey(t)] ? edits[targetKey(t)]!.value : cache.current.values.get(targetKey(t))) : "";
    });
  }, [valueFiltered, sort, needed, edits, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadedCount = useMemo(() => subset.filter((r) => cache.current.values.has(targetKey({ kind: "product", productId: r.id, field: "title" }))).length, [subset, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const cellValue = useCallback(
    (col: Column, productId: string): Value | undefined => {
      const t = targetOf(col, productId, cache.current.variantIds.get(productId) ?? null);
      if (!t) return undefined;
      const e = edits[targetKey(t)];
      return e ? e.value : valueAt(t);
    },
    [edits, valueAt],
  );

  const textOf = useCallback(
    (col: Column, productId: string): string => {
      const t = targetOf(col, productId, cache.current.variantIds.get(productId) ?? null);
      if (!t) return "";
      const k = targetKey(t);
      if (k in texts) return texts[k]!;
      return cellText(col, edits[k] ? edits[k]!.value : valueAt(t));
    },
    [texts, edits, valueAt],
  );

  const noVariant = useCallback(
    (col: Column, productId: string): boolean => col.group === "Prices" && cache.current.variantIds.has(productId) && cache.current.variantIds.get(productId) === null,
    [version], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const cellVariant = useCallback((productId: string): string | null => cache.current.variantIds.get(productId) ?? null, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const isLoaded = useCallback((col: Column, productId: string): boolean => cache.current.fetched.has(`${productId}|${col.id}`), [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCell = useCallback((col: Column, productId: string, text: string) => {
    const t = targetOf(col, productId, cache.current.variantIds.get(productId) ?? null);
    if (!t) return;
    const k = targetKey(t);
    const parsed = parseCell(col, text);
    const base = cache.current.values.get(k) ?? null;
    setTexts((x) => ({ ...x, [k]: text }));
    setEdits((e) => putEdit(e, t, parsed.value, base, { error: parsed.error ?? null }));
  }, []);

  // ---- review
  const rowById = useMemo(() => new Map(products.rows.map((r) => [r.id, r])), [products.rows]);
  const slots = shared.slots;
  const ctx = useMemo<ChangeContext>(() => {
    const names = new Map(defs.map((d) => [defKey(d), d.name]));
    return {
      baseOf: (t) => cache.current.values.get(targetKey(t)) ?? null,
      effectiveOf: (t) => effective(edits, t, cache.current.values.get(targetKey(t)) ?? null),
      productTitle: (id) => (cache.current.values.get(`p|${id}|title`) as string | null | undefined) ?? rowById.get(id)?.title ?? "Product",
      productHandle: (id) => (cache.current.values.get(`p|${id}|handle`) as string | null | undefined) ?? rowById.get(id)?.handle ?? "",
      variantTitle: () => "Default variant",
      slotLabel: (slot) => slots.find((s) => s.key === slot)?.label ?? slot,
      locationName: () => "Location",
      metafieldName: (t) => names.get(`${t.namespace}.${t.key}`) ?? `${t.namespace}.${t.key}`,
    };
  }, [edits, defs, rowById, slots, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const built = useMemo(() => buildChanges(edits, ctx), [edits, ctx]);

  const discard = useCallback((keys: string[]) => {
    setEdits((e) => removeEdits(e, keys));
    setTexts((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k))));
  }, []);
  const discardAll = useCallback(() => {
    setEdits({});
    setTexts({});
  }, []);

  const reread = useCallback(
    (keys: string[]) => {
      for (const k of keys) cache.current.values.delete(k);
      bump();
      // The effect above only runs when the products or columns change, so ask for the read here.
      desired.current = { ids: subset.map((r) => r.id), cols: needed };
      void pump();
    },
    [bump, pump, subset, needed],
  );

  const ensureProducts = useCallback(
    async (ids: string[], cols: Column[]) => {
      // Wait for a running read to give way, then read these products now.
      stop();
      while (running.current) await new Promise((r) => setTimeout(r, 50));
      await loadCells(liveGql, ids, cols, cache.current, {});
      bump();
    },
    [stop, bump],
  );

  const hasEdits = editCount(edits) > 0;
  useEffect(() => {
    if (!hasEdits) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasEdits]);

  return useMemo(
    () => ({
      columns,
      setColumns,
      filters,
      setFilters,
      sort,
      setSort,
      page,
      setPage,
      collections,
      collectionError,
      rows,
      inScope: listFiltered.length,
      waiting: valueFiltered.waiting,
      loadedCount,
      all,
      loadAll,
      progress,
      stop,
      cellValue,
      textOf,
      noVariant,
      cellVariant,
      isLoaded,
      setCell,
      edits,
      built,
      ctx,
      discard,
      discardAll,
      reread,
      ensureProducts,
    }),
    [columns, filters, setFilters, sort, page, collections, collectionError, rows, listFiltered.length, valueFiltered.waiting, loadedCount, all, loadAll, progress, stop, cellValue, textOf, noVariant, cellVariant, isLoaded, setCell, edits, built, ctx, discard, discardAll, reread, ensureProducts],
  );
}
