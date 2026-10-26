import { useEffect, useMemo, useState } from "react";
import { FilterBar } from "../components/FilterBar";
import { InventoryReview } from "../components/InventoryReview";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { ScopeBanner } from "../components/ScopeBanner";
import { SelectField } from "../components/SelectField";
import { onChecked, onInput } from "../lib/dom";
import { activeChips, ANY, applyFilters, filterOptions, NO_FILTERS, NONE } from "../lib/filter";
import { loadStockLocations, planStock, readStock, readStockOverview, settingsProblem, type StockLocation, type StockPlan, type StockSettings, type StockSummary } from "../lib/inventory";
import type { Filters } from "../lib/types";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";

const PAGE_SIZE = 40;
/** Reviewing reads every selected product once, so the number is capped. */
const MAX_SELECTED = 500;
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };

type Stage = "choose" | "reading" | "review";

// Four steps: 1 choose products, 2 choose the stock settings, 3 review (nothing written), 4 apply.
// Typical use: every variant tracked, quantity 1, and not available once sold out.
export default function Inventory() {
  const { shop, products, inventoryUi: ui, refresh } = useAppState();
  useStartProducts(products);
  const { filters, setFilters, selected, setSelected, page, setPage } = ui;

  const [locations, setLocations] = useState<StockLocation[] | null>(null);
  const [locationError, setLocationError] = useState("");
  const [track, setTrack] = useState(true);
  const [stopAtZero, setStopAtZero] = useState(true);
  const [setQuantity, setSetQuantity] = useState(true);
  const [onlyHere, setOnlyHere] = useState(false);
  const [qtyText, setQtyText] = useState("1");
  const [locationIds, setLocationIds] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage>("choose");
  const [plan, setPlan] = useState<StockPlan | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadStockLocations()
      .then((l) => {
        if (cancelled) return;
        setLocations(l);
        setLocationIds((cur) => (cur.size === 0 && l.length === 1 ? new Set([l[0]!.id]) : cur));
      })
      .catch((err) => !cancelled && setLocationError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Current stock picture of the products on this page (read only, cached while you stay on the page).
  const [overview, setOverview] = useState<Record<string, StockSummary>>({});
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [overviewNonce, setOverviewNonce] = useState(0);

  const rows = products.rows;
  const options = useMemo(() => filterOptions(rows), [rows]);
  const filtered = useMemo(() => applyFilters(rows, filters, {}), [rows, filters]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageKey = pageRows.map((p) => p.id).join(",");
  useEffect(() => {
    const missing = pageKey.split(",").filter((id) => id && !(id in overview));
    if (missing.length === 0) {
      setOverviewBusy(false);
      return;
    }
    let cancelled = false;
    setOverviewBusy(true);
    setOverviewError("");
    void (async () => {
      try {
        for (let i = 0; i < missing.length && !cancelled; i += 2) {
          const part = await readStockOverview(missing.slice(i, i + 2));
          if (!cancelled) setOverview((prev) => ({ ...prev, ...part }));
        }
      } catch (err) {
        if (!cancelled) setOverviewError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setOverviewBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, overviewNonce]);
  const refreshStock = () => {
    setOverview({});
    setOverviewNonce((n) => n + 1);
  };

  const pageAllSelected = pageRows.length > 0 && pageRows.every((p) => selected.has(p.id));
  const chips = activeChips(filters, { catalogs: options.catalogs, profiles: [] });
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  const settings: StockSettings = {
    track,
    stopAtZero,
    setQuantity,
    onlyHere,
    quantity: /^\d+$/.test(qtyText.trim()) ? Number(qtyText.trim()) : Number.NaN,
    locations: (locations ?? []).filter((l) => locationIds.has(l.id)),
  };
  const problem = settingsProblem(settings);

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

  const review = async () => {
    setError("");
    setStage("reading");
    try {
      const chosen = rows.filter((p) => selected.has(p.id));
      const states = await readStock(chosen.map((p) => p.id));
      setPlan(planStock({ products: chosen, states, settings }));
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("choose");
    }
  };

  const heading = `Inventory · ${shop.name}`;

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

  if (stage === "reading") {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-section heading="Reading the selected products">
            <Loading message={`Reading ${selected.size} product${selected.size === 1 ? "" : "s"} from Shopify…`} />
          </s-section>
        </PageBody>
      </s-page>
    );
  }


  if (stage === "review" && plan) {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <InventoryReview
            plan={plan}
            onBack={() => setStage("choose")}
            onFinished={() => {
              setStage("choose");
              setPlan(null);
              setSelected(() => new Set());
              refreshStock();
              void refresh();
              products.reload();
            }}
          />
        </PageBody>
      </s-page>
    );
  }

  const tooMany = selected.size > MAX_SELECTED;

  return (
    <s-page heading={heading} inlineSize="large">
      <PageBody>
        <s-stack gap="large-100">
          <ScopeBanner scope={products.scope} count={products.rows.length} onChange={products.setScope} />
          {error ? <s-banner tone="critical" heading="Could not read the products">{error}</s-banner> : null}

          <s-section heading="Step 1 · Choose products">
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
                  {filtered.length} of {rows.length} products · {selected.size} selected
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
                <s-button variant="tertiary" onClick={products.reload}>
                  Refresh products
                </s-button>
                <s-button variant="tertiary" onClick={refreshStock}>
                  Refresh stock
                </s-button>
                {overviewBusy ? <s-text color="subdued">Reading stock for this page…</s-text> : null}
              </s-stack>

              {overviewError ? (
                <s-banner tone="warning" heading="Could not read the stock of some products">
                  <s-paragraph>{overviewError}</s-paragraph>
                  <s-button slot="secondary-actions" onClick={() => setOverviewNonce((n) => n + 1)}>
                    Try again
                  </s-button>
                </s-banner>
              ) : null}

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
                    <s-table-header>Status</s-table-header>
                    <s-table-header>Variants</s-table-header>
                    <s-table-header>Tracked</s-table-header>
                    <s-table-header>When sold out</s-table-header>
                    <s-table-header>Stock by location</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {pageRows.map((p) => (
                      <s-table-row key={p.id}>
                        <s-table-cell>
                          <s-checkbox
                            label={`Select ${p.title}`}
                            labelAccessibilityVisibility="exclusive"
                            checked={selected.has(p.id) || undefined}
                            ref={onChecked((on) => toggleOne(p.id, on))}
                          />
                        </s-table-cell>
                        <s-table-cell>{p.title}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{STATUS_LABEL[p.status] ?? p.status}</s-badge>
                        </s-table-cell>
                        <s-table-cell>{p.variantCount > 0 ? p.variantCount : "—"}</s-table-cell>
                        <StockCells summary={overview[p.id]} busy={overviewBusy} />
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

          <s-section heading="Step 2 · Choose the stock settings">
            <s-stack gap="base">
              <s-text color="subdued">
                The same settings are applied to every variant of every selected product. Only what is switched on is changed.
              </s-text>
              <s-checkbox label="Track quantity" details="Shopify counts the stock and reduces it with every sale." checked={track || undefined} ref={onChecked(setTrack)} />
              <s-checkbox
                label="Sold out = not available"
                details="Turns off “Continue selling when out of stock”, so a variant cannot be bought once its stock is 0."
                checked={stopAtZero || undefined}
                ref={onChecked(setStopAtZero)}
              />
              <s-checkbox label="Set the quantity" checked={setQuantity || undefined} ref={onChecked(setSetQuantity)} />
              {setQuantity ? (
                <s-text-field
                  label="Quantity for every variant"
                  value={qtyText}
                  error={Number.isNaN(settings.quantity) ? "Whole number, 0 or more." : undefined}
                  ref={onInput(setQtyText)}
                />
              ) : null}
              <s-checkbox
                label="Only these locations"
                details="Takes every variant out of all the locations that are not ticked below, so it stays stocked only at the ticked ones."
                checked={onlyHere || undefined}
                ref={onChecked(setOnlyHere)}
              />
              {setQuantity || onlyHere ? (
                <s-stack gap="base">
                  {locations === null && !locationError ? (
                    <Loading message="Reading locations…" />
                  ) : locationError ? (
                    <s-banner tone="critical" heading="Locations could not be read">
                      <s-paragraph>{locationError}</s-paragraph>
                    </s-banner>
                  ) : (
                    <s-stack gap="small-200">
                      <s-heading>Locations (tick one or more)</s-heading>
                      {(locations ?? []).map((l) => (
                        <s-checkbox
                          key={l.id}
                          label={l.name}
                          checked={locationIds.has(l.id) || undefined}
                          ref={onChecked((on) =>
                            setLocationIds((prev) => {
                              const next = new Set(prev);
                              if (on) next.add(l.id);
                              else next.delete(l.id);
                              return next;
                            }),
                          )}
                        />
                      ))}
                    </s-stack>
                  )}
                  <s-text color="subdued">
                    {setQuantity ? "The quantity replaces the current stock at each ticked location, also when it is higher. " : ""}
                    {onlyHere
                      ? "Locations that are not ticked are removed from the variants (a variant not stocked at a ticked location keeps its others). Stock held at a removed location is lost."
                      : "Locations that are not ticked are not touched."}
                  </s-text>
                </s-stack>
              ) : null}
              {tooMany ? <s-banner tone="critical" heading={`Select ${MAX_SELECTED} products or fewer at a time (you have ${selected.size}).`} /> : null}
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button variant="primary" disabled={selected.size === 0 || problem !== null || tooMany || undefined} onClick={() => void review()}>
                  {`Review changes for ${selected.size} product${selected.size === 1 ? "" : "s"}`}
                </s-button>
                {selected.size === 0 ? <s-text color="subdued">Select products first.</s-text> : problem ? <s-text color="subdued">{problem}</s-text> : null}
              </s-stack>
            </s-stack>
          </s-section>
        </s-stack>
      </PageBody>
    </s-page>
  );
}

// Three cells next to each product: tracked, what happens at 0, and the stock at every location it is stocked at.
function StockCells({ summary, busy }: { summary: StockSummary | undefined; busy: boolean }) {
  if (!summary) {
    const text = busy ? "…" : "—";
    return (
      <>
        <s-table-cell>{text}</s-table-cell>
        <s-table-cell>{text}</s-table-cell>
        <s-table-cell>{text}</s-table-cell>
      </>
    );
  }
  const n = summary.variants;
  const some = (count: number) => (count === n ? "all" : count === 0 ? "none" : "some");
  const tracked = some(summary.tracked);
  const stops = some(summary.stops);
  return (
    <>
      <s-table-cell>
        <s-badge tone={tracked === "all" ? "success" : tracked === "none" ? "critical" : "warning"}>
          {tracked === "all" ? "Tracked" : tracked === "none" ? "Not tracked" : `${summary.tracked} of ${n} tracked`}
        </s-badge>
      </s-table-cell>
      <s-table-cell>
        <s-badge tone={stops === "all" ? "success" : stops === "none" ? "warning" : "warning"}>
          {stops === "all" ? "Stops at 0" : stops === "none" ? "Keeps selling" : `${summary.stops} of ${n} stop at 0`}
        </s-badge>
      </s-table-cell>
      <s-table-cell>
        {summary.locations.length === 0 ? (
          <s-text color="subdued">Not stocked anywhere</s-text>
        ) : (
          <s-stack gap="small-300">
            {summary.locations.map((l) => (
              <s-text key={l.id}>
                {`${l.name}: ${l.available}`}
                {l.variants < n ? <s-text color="subdued">{` (${l.variants} of ${n} variants)`}</s-text> : null}
              </s-text>
            ))}
          </s-stack>
        )}
        {!summary.complete ? <s-text color="subdued">First 40 variants only</s-text> : null}
      </s-table-cell>
    </>
  );
}
