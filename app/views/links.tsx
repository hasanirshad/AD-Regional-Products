import { useEffect, useMemo, useState } from "react";
import { FilterBar } from "../components/FilterBar";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { ScopeBanner } from "../components/ScopeBanner";
import { SelectField } from "../components/SelectField";
import { normalizeBase, readOverrides, writeOverrides, type DomainOverrides } from "../lib/domains";
import { onChecked, onInput } from "../lib/dom";
import { activeChips, ANY, applyFilters, filterOptions, NO_FILTERS, NONE } from "../lib/filter";
import { buildLinks, isUsMarket, linksCsv, pickRoot, STAY_PARAM, themeLabel, type MarketRoot, type Theme, type WebPresence } from "../lib/links";
import { sellingMarkets } from "../lib/overview";
import { downloadCsv } from "../lib/report";
import { loadMarketRoots, loadThemes } from "../lib/shopify-data";
import type { Filters } from "../lib/types";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";

const PAGE_SIZE = 25;
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };
const LIVE = "live";
const OTHER = "other";

const SOURCE_TEXT = {
  domain: "Own domain",
  subfolder: "Subfolder",
  primary: "Store primary domain (the market has no web presence)",
  manual: "Typed in by you",
} as const;

// Read only. Nothing here changes the store, so there is no password.
export default function Links() {
  const { shop, markets, products, linksUi: ui } = useAppState();
  useStartProducts(products);
  const { filters, setFilters, selected, setSelected, page, setPage } = ui;

  const [roots, setRoots] = useState<{ primaryUrl: string; presences: Record<string, WebPresence[]> } | null>(null);
  const [rootsError, setRootsError] = useState("");
  const [themes, setThemes] = useState<Theme[] | null>(null);
  const [themesError, setThemesError] = useState("");
  const [themeChoice, setThemeChoice] = useState(LIVE);
  const [manualId, setManualId] = useState("");
  const [saved, setSaved] = useState<DomainOverrides>(() => readOverrides());
  const [drafts, setDrafts] = useState<Record<string, string>>(() => readOverrides());
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const [saveNote, setSaveNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadMarketRoots()
      .then((r) => !cancelled && setRoots(r))
      .catch((e) => !cancelled && setRootsError(e instanceof Error ? e.message : String(e)));
    loadThemes()
      .then((t) => !cancelled && setThemes(t))
      .catch((e) => !cancelled && (setThemes([]), setThemesError(e instanceof Error ? e.message : String(e))));
    return () => {
      cancelled = true;
    };
  }, []);

  const sellMarkets = useMemo(() => sellingMarkets(markets), [markets]);
  const marketRoots = useMemo<Record<string, MarketRoot>>(() => {
    const out: Record<string, MarketRoot> = {};
    for (const m of sellMarkets) {
      const typed = saved[m.id];
      if (typed) out[m.id] = { root: typed, source: "manual" };
      else if (roots) out[m.id] = pickRoot(roots.presences[m.id] ?? [], roots.primaryUrl);
    }
    return out;
  }, [roots, sellMarkets, saved]);
  // The page works with typed addresses alone, so a failed read does not block it.
  const rootsReady = roots !== null || rootsError !== "";

  const dirty = sellMarkets.some((m) => (drafts[m.id] ?? "") !== (saved[m.id] ?? ""));
  const saveDomains = () => {
    const next: DomainOverrides = {};
    const errors: Record<string, string> = {};
    for (const m of sellMarkets) {
      const r = normalizeBase(drafts[m.id] ?? "");
      if (!r.ok) errors[m.id] = r.error;
      else if (r.value) next[m.id] = r.value;
    }
    setDraftErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveNote("");
      return;
    }
    const ok = writeOverrides(next);
    setSaved(next);
    setDrafts({ ...next });
    setSaveNote(ok ? "Saved in this browser." : "Used for this visit only: the browser would not save it.");
  };

  // The preview id. "" = the live theme, which needs no parameter.
  const manualOk = /^\d+$/.test(manualId.trim());
  const themeId =
    themeChoice === LIVE ? "" : themeChoice === OTHER ? (manualOk ? manualId.trim() : "") : (themes?.find((t) => t.numericId === themeChoice)?.role === "MAIN" ? "" : themeChoice);

  const options = useMemo(() => filterOptions(products.rows), [products.rows]);
  const filtered = useMemo(() => applyFilters(products.rows, filters, {}), [products.rows, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageAllSelected = pageRows.length > 0 && pageRows.every((p) => selected.has(p.id));
  const chips = activeChips(filters, { catalogs: options.catalogs, profiles: [] });
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  const linkRows = useMemo(
    () => buildLinks({ products: pageRows, markets: sellMarkets, roots: marketRoots, themeId, myshopifyDomain: shop.domain }),
    [pageRows, sellMarkets, marketRoots, themeId, shop.domain],
  );

  const exportRows = (list: typeof filtered) =>
    downloadCsv(
      `storefront-links-${themeId ? `preview-${themeId}` : "live"}-${new Date().toISOString().slice(0, 10)}.csv`,
      linksCsv(buildLinks({ products: list, markets: sellMarkets, roots: marketRoots, themeId, myshopifyDomain: shop.domain })),
    );
  const chosen = products.rows.filter((p) => selected.has(p.id));

  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const togglePage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of pageRows) {
        if (on) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });

  const heading = `Storefront links · ${shop.name}`;

  if (products.status === "idle" || products.status === "loading") {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-section heading="Products">
            <Loading message={products.loaded > 0 ? `Loading products… ${products.loaded} so far` : "Loading products…"} />
          </s-section>
        </PageBody>
      </s-page>
    );
  }
  if (products.status === "error") {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-banner tone="critical" heading="Could not load products">
            <s-paragraph>{products.error}</s-paragraph>
            <s-button slot="secondary-actions" onClick={products.reload}>
              Try again
            </s-button>
          </s-banner>
        </PageBody>
      </s-page>
    );
  }

  const themeOptions = [
    { value: LIVE, label: "Live theme" },
    ...(themes ?? []).filter((t) => t.role !== "MAIN").map((t) => ({ value: t.numericId, label: `${themeLabel(t)} · ${t.numericId}` })),
    { value: OTHER, label: "Another theme: enter its id" },
  ];

  return (
    <s-page heading={heading} inlineSize="large">
      <PageBody>
        <s-stack gap="large-100">
          <ScopeBanner scope={products.scope} count={products.rows.length} onChange={products.setScope} />

          <s-section heading="Theme and markets">
            <s-stack gap="base">
              {themes === null ? <Loading message="Reading themes…" /> : null}
              {themesError ? (
                <s-banner tone="info" heading="Themes could not be listed">
                  <s-paragraph>
                    The app needs the "read themes" permission for that (it is in the app config; it takes effect after the app is deployed and the new permission is approved in the store). Until then choose "Another theme" and enter the theme id from its address in Shopify (online-store/themes/<b>123456789</b>).
                  </s-paragraph>
                </s-banner>
              ) : null}
              <SelectField label="Theme to link to" value={themeChoice} onChange={setThemeChoice} options={themeOptions} />
              {themeChoice === OTHER ? (
                <s-text-field label="Theme id (numbers only)" value={manualId} ref={onInput(setManualId)} />
              ) : null}
              {themeChoice === OTHER && manualId && !manualOk ? <s-text tone="critical">The theme id is only digits, like 123456789012.</s-text> : null}
              <s-text color="subdued">
                {themeId
                  ? `Links open the store with preview_theme_id=${themeId}. Only people logged in to the admin can see an unpublished theme.`
                  : "Links open the live theme."}
              </s-text>

              {rootsError ? <s-banner tone="critical" heading="Could not read the market domains">{rootsError}</s-banner> : null}
              {!rootsReady ? (
                <Loading message="Reading market domains…" />
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Market</s-table-header>
                    <s-table-header>Base address used</s-table-header>
                    <s-table-header>Source</s-table-header>
                    <s-table-header>Type the base domain (optional)</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {sellMarkets.map((m) => {
                      const r = marketRoots[m.id];
                      return (
                        <s-table-row key={m.id}>
                          <s-table-cell>
                            {m.name}
                            {isUsMarket(m) ? <s-badge tone="info">{`${STAY_PARAM.name}=${STAY_PARAM.value}`}</s-badge> : null}
                          </s-table-cell>
                          <s-table-cell>{r ? r.root : "—"}</s-table-cell>
                          <s-table-cell>{r ? SOURCE_TEXT[r.source] : "Not found: type it in"}</s-table-cell>
                          <s-table-cell>
                            <s-text-field
                              label={`Base domain for ${m.name}`}
                              labelAccessibilityVisibility="exclusive"
                              placeholder="https://hardman.de"
                              value={drafts[m.id] ?? ""}
                              error={draftErrors[m.id] || undefined}
                              ref={onInput((v) => setDrafts((d) => ({ ...d, [m.id]: v })))}
                            />
                          </s-table-cell>
                        </s-table-row>
                      );
                    })}
                  </s-table-body>
                </s-table>
              )}
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button variant="primary" disabled={!dirty || undefined} onClick={saveDomains}>
                  Save domains
                </s-button>
                {saveNote ? <s-text color="subdued">{saveNote}</s-text> : null}
                {!saveNote ? <s-text color="subdued">An address typed here replaces the one from Shopify. Clear the field and save to go back to Shopify's. Saved in this browser only; nothing is sent anywhere.</s-text> : null}
              </s-stack>
              <s-text color="subdued">
                The US link gets {STAY_PARAM.name}={STAY_PARAM.value}, so visitors from outside the US are not redirected away.
              </s-text>
            </s-stack>
          </s-section>

          <s-section heading="Products">
            <s-stack gap="base">
              <FilterBar
                search={filters.search}
                onSearch={(search) => set({ search })}
                placeholder="Search by title, handle, vendor, type or tag"
                activeCount={chips.length}
                chips={chips}
                onRemoveChip={(key) => set({ [key]: "" } as Partial<Filters>)}
                onClear={() => setFilters(NO_FILTERS)}
              >
                <SelectField
                  label="Status"
                  value={filters.status}
                  onChange={(status) => set({ status })}
                  options={[{ value: "", label: "Any status" }, ...options.statuses.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }))]}
                />
                <SelectField
                  label="Vendor"
                  value={filters.vendor}
                  onChange={(vendor) => set({ vendor })}
                  options={[{ value: "", label: "Any vendor" }, ...options.vendors.map((v) => ({ value: v, label: v }))]}
                />
                <SelectField
                  label="Product type"
                  value={filters.productType}
                  onChange={(productType) => set({ productType })}
                  options={[{ value: "", label: "Any type" }, ...options.types.map((t) => ({ value: t, label: t }))]}
                />
                <SelectField
                  label="Tag"
                  value={filters.tag}
                  onChange={(tag) => set({ tag })}
                  options={[{ value: "", label: "Any tag" }, ...options.tags.map((t) => ({ value: t, label: t }))]}
                />
                <SelectField
                  label="Catalogue"
                  value={filters.catalog}
                  onChange={(catalog) => set({ catalog })}
                  options={[
                    { value: "", label: "Any" },
                    { value: NONE, label: "Not in any catalogue" },
                    { value: ANY, label: "In any catalogue" },
                    ...options.catalogs.map((c) => ({ value: c.id, label: c.title })),
                  ]}
                />
              </FilterBar>

              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text color="subdued">
                  {filtered.length} of {products.rows.length} products · {selected.size} selected
                </s-text>
                {filtered.length > 0 && selected.size < filtered.length ? (
                  <s-button variant="tertiary" onClick={() => setSelected(() => new Set(filtered.map((p) => p.id)))}>
                    {`Select all ${filtered.length} matching`}
                  </s-button>
                ) : null}
                {selected.size > 0 ? (
                  <s-button variant="tertiary" onClick={() => setSelected(() => new Set())}>
                    Clear selection
                  </s-button>
                ) : null}
              </s-stack>

              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button variant="primary" disabled={chosen.length === 0 || !rootsReady || undefined} onClick={() => exportRows(chosen)}>
                  {`Export ${chosen.length} selected (CSV)`}
                </s-button>
                <s-button disabled={filtered.length === 0 || !rootsReady || undefined} onClick={() => exportRows(filtered)}>
                  {`Export all ${filtered.length} matching`}
                </s-button>
                <s-text color="subdued">One row per product and market: title, market, store link, admin link.</s-text>
              </s-stack>

              {filtered.length === 0 ? (
                <s-stack gap="small-100">
                  <s-paragraph>No products match these filters.</s-paragraph>
                  <div>
                    <s-button onClick={() => setFilters(NO_FILTERS)}>Clear filters</s-button>
                  </div>
                </s-stack>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>
                      <s-checkbox
                        label="Select this page"
                        labelAccessibilityVisibility="exclusive"
                        checked={pageAllSelected || undefined}
                        ref={onChecked(togglePage)}
                      />
                    </s-table-header>
                    <s-table-header>Product</s-table-header>
                    {sellMarkets.map((m) => (
                      <s-table-header key={m.id}>{m.name}</s-table-header>
                    ))}
                    <s-table-header>Admin</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {linkRows.map((r) => (
                      <s-table-row key={r.product.id}>
                        <s-table-cell>
                          <s-checkbox
                            label={`Select ${r.product.title}`}
                            labelAccessibilityVisibility="exclusive"
                            checked={selected.has(r.product.id) || undefined}
                            ref={onChecked((on) => toggleOne(r.product.id, on))}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          {r.product.title}
                          {r.product.status !== "ACTIVE" ? <s-text color="subdued">{` · ${STATUS_LABEL[r.product.status] ?? r.product.status}`}</s-text> : null}
                        </s-table-cell>
                        {sellMarkets.map((m) => {
                          const cell = r.markets.find((x) => x.marketId === m.id);
                          return (
                            <s-table-cell key={m.id}>
                              {cell ? (
                                <>
                                  <s-link href={cell.url} target="_blank">
                                    Open
                                  </s-link>
                                  {!cell.published ? (
                                    <>
                                      <br />
                                      <s-text color="subdued">not published</s-text>
                                    </>
                                  ) : null}
                                </>
                              ) : (
                                "—"
                              )}
                            </s-table-cell>
                          );
                        })}
                        <s-table-cell>
                          <s-link href={r.admin} target="_blank">
                            Open
                          </s-link>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}

              {filtered.length > PAGE_SIZE ? (
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-button disabled={safePage === 0 || undefined} onClick={() => setPage(safePage - 1)}>
                    Previous
                  </s-button>
                  <s-text color="subdued">
                    Page {safePage + 1} of {pages}
                  </s-text>
                  <s-button disabled={safePage >= pages - 1 || undefined} onClick={() => setPage(safePage + 1)}>
                    Next
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          </s-section>
        </s-stack>
      </PageBody>
    </s-page>
  );
}
