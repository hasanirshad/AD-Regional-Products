// Product list and the user's working state (filters, selection, staged
// moves). Lives in the layout so leaving the page and coming back loses
// nothing. Products load lazily the first time the Products page opens.

import type { InvFilters } from "../lib/inventoryFilter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NO_FILTERS } from "../lib/filter";
import { buildParts } from "../lib/parts";
import { loadMembership, loadProductsPage, PRODUCT_QUERY } from "../lib/shopify-data";
import type { Filters, Membership, Parts, ProductCatalog, ProductRow, ProfileSummary } from "../lib/types";
import type { AppState } from "./state";

export type ProductScope = "active" | "all";

/** 25 products per page: 400 pages = 10,000 products. Past that a note is shown. */
const MAX_PRODUCT_PAGES = 400;

export type ProductsLoad = {
  /** active = quick first load (active products only). all = also drafts and archived. */
  scope: ProductScope;
  /** Reads the products again with this scope. */
  setScope: (scope: ProductScope) => void;
  status: "idle" | "loading" | "ready" | "error";
  rows: ProductRow[];
  membership: Membership;
  /** Where each product's variants are (more than one entry = split across profiles). */
  parts: Parts;
  /** Things that could not be read in full, shown as a note on the Overview. */
  notes: string[];
  /** Per product: its catalogues in hidden markets (Global). The rows leave them out; the Channels page adds them back. */
  hiddenCatalogs: Record<string, ProductCatalog[]>;
  /** Products read so far, for the progress message. */
  loaded: number;
  error: string;
  /** Starts loading once, the first time it is called. A failed load is retried with `reload`. */
  load: () => void;
  /** Reads everything again. */
  reload: () => void;
};

export function useProductsLoad(app: Pick<AppState, "profiles" | "hiddenCatalogIds"> | null): ProductsLoad {
  const [status, setStatus] = useState<ProductsLoad["status"]>("idle");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [membership, setMembership] = useState<Membership>({});
  const [parts, setParts] = useState<Parts>({});
  const [notes, setNotes] = useState<string[]>([]);
  const [hiddenCatalogs, setHiddenCatalogs] = useState<Record<string, ProductCatalog[]>>({});
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState("");
  const [scope, setScopeState] = useState<ProductScope>("active");
  const scopeRef = useRef<ProductScope>("active");
  const running = useRef(false);
  const latest = useRef<{ profiles: ProfileSummary[]; hiddenCatalogIds: string[] } | null>(null);
  latest.current = app;

  const run = useCallback(async (next?: ProductScope) => {
    if (running.current || !latest.current) return;
    if (next) {
      scopeRef.current = next;
      setScopeState(next);
    }
    running.current = true;
    setStatus("loading");
    setError("");
    setLoaded(0);
    try {
      const all: ProductRow[] = [];
      const found: string[] = [];
      let after: string | null = null;
      for (let page = 0; ; page++) {
        const res = await loadProductsPage(after, PRODUCT_QUERY[scopeRef.current]);
        all.push(...res.rows);
        setLoaded(all.length);
        if (!res.hasNext) break;
        if (page >= MAX_PRODUCT_PAGES) {
          found.push(`Only the first ${all.length} products were read. The numbers below leave out the rest.`);
          break;
        }
        after = res.cursor;
      }
      const { profiles, hiddenCatalogIds } = latest.current ?? { profiles: [], hiddenCatalogIds: [] };
      const contents = await loadMembership(profiles);
      if (contents.truncated) found.push("A shipping profile holds more products than were read. Its numbers may be incomplete.");
      if (!contents.variantsKnown) found.push("Shopify did not give the variants of each profile, so products split across profiles cannot be detected.");
      const hidden = new Set(hiddenCatalogIds);
      const rows = hidden.size === 0 ? all : all.map((p) => ({ ...p, catalogs: p.catalogs.filter((c) => !hidden.has(c.id)) }));
      const hiddenOf: Record<string, ProductCatalog[]> = {};
      if (hidden.size > 0) {
        for (const p of all) {
          const h = p.catalogs.filter((c) => hidden.has(c.id));
          if (h.length > 0) hiddenOf[p.id] = h;
        }
      }
      const built = buildParts(rows, contents.items, contents.variantsKnown);
      setRows(rows);
      setMembership(built.membership);
      setParts(built.parts);
      setNotes(found);
      setHiddenCatalogs(hiddenOf);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      running.current = false;
    }
  }, []);

  const load = useCallback(() => {
    if (status === "idle") void run();
  }, [status, run]);

  return useMemo(
    () => ({
      scope,
      setScope: (next: ProductScope) => void run(next),
      status,
      rows,
      membership,
      parts,
      notes,
      hiddenCatalogs,
      loaded,
      error,
      load,
      reload: () => void run(),
    }),
    [scope, status, rows, membership, parts, notes, hiddenCatalogs, loaded, error, load, run],
  );
}

export type ProductsUi = {
  filters: Filters;
  setFilters: (f: Filters) => void;
  selected: Set<string>;
  setSelected: (update: (prev: Set<string>) => Set<string>) => void;
  page: number;
  setPage: (n: number) => void;
};

export function useProductsUi(): ProductsUi {
  const [filters, setFiltersRaw] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);

  // Any filter change goes back to page 1.
  const setFilters = useCallback((f: Filters) => {
    setFiltersRaw(f);
    setPage(0);
  }, []);

  return useMemo(
    () => ({ filters, setFilters, selected, setSelected, page, setPage }),
    [filters, setFilters, selected, page],
  );
}

export type Shared = AppState & { products: ProductsLoad; ui: ProductsUi; channelsUi: ProductsUi; linksUi: ProductsUi; checkUi: ProductsUi; inventoryUi: ProductsUi; invFilters: { value: InvFilters; set: (f: InvFilters) => void } };

// Keep the effect-based starter next to the types it needs.
export function useStartProducts(products: ProductsLoad) {
  useEffect(() => {
    products.load();
  }, [products.load]); // eslint-disable-line react-hooks/exhaustive-deps
}
