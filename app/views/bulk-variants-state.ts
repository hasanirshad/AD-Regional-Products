// Bulk edit, Variants mode: the working state. Which products were chosen, the variant columns, what was read, and what
// was typed but not saved. It lives in the layout (next to the Products mode state), so leaving the page loses nothing.
// Reading is free and has a Stop button. Writing goes through the same review, password, recheck, read-back and Undo as
// everywhere else.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseCell, type Column } from "../lib/editor/bulk";
import {
  MAX_PRODUCTS,
  cellBlocker,
  loadVariantCells,
  loadVariantRows,
  newVariantCache,
  variantCellText,
  variantRowsOf,
  variantTargetOf,
  type VariantCache,
  type VariantRow,
} from "../lib/editor/bulkVariants";
import { buildChanges, type BuiltChanges, type ChangeContext } from "../lib/editor/changes";
import { editCount, effective, putEdit, removeEdits, type EditMap } from "../lib/editor/edits";
import { liveGql, messageOf } from "../lib/editor/gql";
import { defKey } from "../lib/editor/load";
import { targetKey, type Value } from "../lib/editor/model";
import type { EditorShared } from "./editor-state";

export type BulkMode = "products" | "variants";
export type VariantStep = "products" | "columns" | "table";
export const VARIANT_PAGE_SIZE = 40;

export type VariantBulkState = {
  mode: BulkMode;
  setMode: (m: BulkMode) => void;
  step: VariantStep;
  setStep: (s: VariantStep) => void;

  /** Product ids chosen in step 1, in the order chosen. */
  selected: string[];
  select: (ids: string[]) => void;
  unselect: (ids: string[]) => void;
  clearSelection: () => void;

  columns: Column[];
  setColumns: (c: Column[]) => void;

  rows: VariantRow[];
  /** Titles of products with more variants than the table shows. */
  truncated: string[];
  page: number;
  setPage: (n: number) => void;
  progress: { busy: boolean; done: number; total: number; error: string };
  stop: () => void;

  textOf: (col: Column, row: VariantRow) => string;
  /** Why the cell cannot be typed in (null = it can). */
  blockerOf: (col: Column, row: VariantRow) => string | null;
  errorOf: (col: Column, row: VariantRow) => string | null;
  editedOf: (col: Column, row: VariantRow) => boolean;
  loadedOf: (col: Column, row: VariantRow) => boolean;
  setCell: (col: Column, row: VariantRow, text: string) => void;

  edits: EditMap;
  built: BuiltChanges;
  ctx: ChangeContext;
  discard: (keys: string[]) => void;
  discardAll: () => void;
  /** After a save: read everything again so the table shows what Shopify has now. */
  reread: () => void;
};

export function useVariantBulk(shared: EditorShared): VariantBulkState {
  const [mode, setMode] = useState<BulkMode>("products");
  const [step, setStep] = useState<VariantStep>("products");
  const [selected, setSelected] = useState<string[]>([]);
  const [columns, setColumnsRaw] = useState<Column[]>([]);
  const [page, setPage] = useState(0);
  const [edits, setEdits] = useState<EditMap>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);
  const [progress, setProgress] = useState({ busy: false, done: 0, total: 0, error: "" });
  const cache = useRef<VariantCache>(newVariantCache());
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const select = useCallback((ids: string[]) => setSelected((s) => [...s, ...ids.filter((id) => !s.includes(id))].slice(0, MAX_PRODUCTS)), []);
  const unselect = useCallback((ids: string[]) => setSelected((s) => s.filter((id) => !ids.includes(id))), []);
  const clearSelection = useCallback(() => setSelected([]), []);
  const setColumns = useCallback((c: Column[]) => {
    setColumnsRaw(c);
    setPage(0);
  }, []);

  // ---- reading (the latest request wins)
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
        const shouldStop = () => stopFlag.current || desired.current !== null;
        try {
          await loadVariantRows(liveGql, d.ids, cache.current, { shouldStop });
          bump();
          const rows = variantRowsOf(d.ids, cache.current);
          await loadVariantCells(liveGql, rows, d.cols, cache.current, {
            shouldStop,
            onProgress: (done, total) => {
              setProgress({ busy: true, done, total, error: "" });
              bump();
            },
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

  const selectedKey = selected.join(",");
  const columnsKey = columns.map((c) => c.id).join("|");
  useEffect(() => {
    if (mode !== "variants" || step !== "table" || selected.length === 0) return;
    const timer = setTimeout(() => {
      desired.current = { ids: selected, cols: columns };
      void pump();
    }, 200);
    return () => clearTimeout(timer);
  }, [mode, step, selectedKey, columnsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    desired.current = null;
    stopFlag.current = true;
  }, []);

  // ---- rows and cells
  const rows = useMemo(() => variantRowsOf(selected, cache.current), [selectedKey, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const truncated = useMemo(() => selected.filter((id) => cache.current.truncated.has(id)).map((id) => cache.current.rows.get(id)?.[0]?.productTitle ?? id), [selectedKey, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const textOf = useCallback(
    (col: Column, row: VariantRow): string => {
      const t = variantTargetOf(col, row, cache.current);
      if (!t) return "";
      const k = targetKey(t);
      if (k in texts) return texts[k]!;
      return variantCellText(col, row, cache.current, edits);
    },
    [texts, edits, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const blockerOf = useCallback((col: Column, row: VariantRow) => cellBlocker(col, row, cache.current), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadedOf = useCallback((col: Column, row: VariantRow) => cache.current.fetched.has(`${row.id}|${col.id}`), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const errorOf = useCallback(
    (col: Column, row: VariantRow) => {
      const t = variantTargetOf(col, row, cache.current);
      return t ? (edits[targetKey(t)]?.error ?? null) : null;
    },
    [edits, version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const editedOf = useCallback(
    (col: Column, row: VariantRow) => {
      const t = variantTargetOf(col, row, cache.current);
      return t ? targetKey(t) in edits : false;
    },
    [edits, version], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const setCell = useCallback((col: Column, row: VariantRow, text: string) => {
    const t = variantTargetOf(col, row, cache.current);
    if (!t) return;
    const k = targetKey(t);
    const parsed = parseCell(col, text);
    const base = cache.current.values.get(k) ?? null;
    setTexts((x) => ({ ...x, [k]: text }));
    setEdits((e) => putEdit(e, t, parsed.value, base, { error: parsed.error ?? null }));
  }, []);

  // ---- review
  const defs = shared.variantDefs.data ?? [];
  const slots = shared.slots;
  const ctx = useMemo<ChangeContext>(() => {
    const names = new Map(defs.map((d) => [defKey(d), d.name]));
    const all = [...cache.current.rows.values()].flat();
    const byVariant = new Map(all.map((r) => [r.id, r]));
    const byProduct = new Map(all.map((r) => [r.productId, r]));
    const base = (t: Parameters<ChangeContext["baseOf"]>[0]): Value => cache.current.values.get(targetKey(t)) ?? null;
    // metafield id -> "Length · Oak / 180"
    const owner = new Map<string, string>();
    for (const [k, id] of cache.current.metafieldIds) {
      const [variantId, name] = k.split("|") as [string, string];
      owner.set(id, `${names.get(name) ?? name} · ${byVariant.get(variantId)?.title ?? "variant"}`);
    }
    return {
      baseOf: base,
      effectiveOf: (t) => effective(edits, t, base(t)),
      productTitle: (id) => byProduct.get(id)?.productTitle ?? "Product",
      productHandle: (id) => byProduct.get(id)?.productHandle ?? "",
      variantTitle: (id) => byVariant.get(id)?.title ?? "Variant",
      slotLabel: (slot) => slots.find((s) => s.key === slot)?.label ?? slot,
      locationName: () => "Location",
      metafieldName: (t) => names.get(`${t.namespace}.${t.key}`) ?? `${t.namespace}.${t.key}`,
      resourceName: (t) => owner.get(t.resourceId),
    };
  }, [edits, defs, slots, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const built = useMemo(() => buildChanges(edits, ctx), [edits, ctx]);

  const discard = useCallback((keys: string[]) => {
    setEdits((e) => removeEdits(e, keys));
    setTexts((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k))));
  }, []);
  const discardAll = useCallback(() => {
    setEdits({});
    setTexts({});
  }, []);

  const reread = useCallback(() => {
    // A saved metafield can have a new id (so it can now be translated): start the cache again.
    cache.current = newVariantCache();
    bump();
    desired.current = { ids: selected, cols: columns };
    void pump();
  }, [bump, pump, selected, columns]);

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
    () => ({ mode, setMode, step, setStep, selected, select, unselect, clearSelection, columns, setColumns, rows, truncated, page, setPage, progress, stop, textOf, blockerOf, errorOf, editedOf, loadedOf, setCell, edits, built, ctx, discard, discardAll, reread }),
    [mode, step, selected, select, unselect, clearSelection, columns, setColumns, rows, truncated, page, progress, stop, textOf, blockerOf, errorOf, editedOf, loadedOf, setCell, edits, built, ctx, discard, discardAll, reread],
  );
}
