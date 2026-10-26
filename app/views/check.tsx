import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { FilterBar } from "../components/FilterBar";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { SelectField } from "../components/SelectField";
import { summarizeCodes } from "../lib/countries";
import { buildProductCheck, type ProductCheck, type ProductDetail, type Result } from "../lib/check";
import { activeChips, ANY, applyFilters, filterOptions, NO_FILTERS, NONE } from "../lib/filter";
import { loadProductDetail } from "../lib/shopify-data";
import type { Filters } from "../lib/types";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";

const PAGE_SIZE = 15;
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };

const RESULT: Record<Result, { tone: "success" | "warning" | "critical" | "neutral"; label: string }> = {
  buy: { tone: "success", label: "Can be bought" },
  partial: { tone: "warning", label: "Partly: some countries blocked" },
  cannot: { tone: "critical", label: "Visible, cannot check out" },
  hidden: { tone: "neutral", label: "Not visible" },
};

const yes = (v: boolean) => <s-badge tone={v ? "success" : "neutral"}>{v ? "Yes" : "No"}</s-badge>;

export default function Check() {
  const { shop, markets, profiles, hiddenCatalogIds, products, checkUi: ui } = useAppState();
  useStartProducts(products);
  const [params, setParams] = useSearchParams();
  const productId = params.get("product") ?? "";
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: ProductDetail | null }
  >({ status: "idle" });
  const [nonce, setNonce] = useState(0);

  // Read the chosen product fresh every time (never from the cached list).
  useEffect(() => {
    if (!productId) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    loadProductDetail(`gid://shopify/Product/${productId}`, hiddenCatalogIds)
      .then((detail) => !cancelled && setState({ status: "ready", detail }))
      .catch((err) => !cancelled && setState({ status: "error", message: err instanceof Error ? err.message : String(err) }));
    return () => {
      cancelled = true;
    };
  }, [productId, nonce, hiddenCatalogIds]);

  const { filters, setFilters, page, setPage } = ui;
  const options = useMemo(() => filterOptions(products.rows), [products.rows]);
  const filtered = useMemo(() => applyFilters(products.rows, filters, {}), [products.rows, filters]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const chips = activeChips(filters, { catalogs: options.catalogs, profiles: [] });
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

  const check = useMemo(
    () =>
      state.status === "ready" && state.detail
        ? buildProductCheck({ detail: state.detail, markets: markets.filter((m) => m.countries.length > 0), profiles })
        : null,
    [state, markets, profiles],
  );

  const choose = (numericId: string) => setParams({ product: numericId });
  const back = () => setParams({});

  return (
    <s-page heading={`Product check · ${shop.name}`} inlineSize="large">
      <PageBody>
        <s-stack gap="large-100">
          {!productId ? (
            <s-section heading="Choose a product">
              <s-stack gap="base">
                {products.status === "loading" || products.status === "idle" ? (
                  <Loading message={products.loaded > 0 ? `Loading products… ${products.loaded} so far` : "Loading products…"} />
                ) : null}
                {products.status === "error" ? <s-banner tone="critical" heading="Could not load products">{products.error}</s-banner> : null}
                {products.status === "ready" ? (
                  <>
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
                    <s-text color="subdued">
                      {filtered.length} of {products.rows.length} products. Draft and archived products appear after you load all products on the Products page.
                    </s-text>
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
                          <s-table-header>Product</s-table-header>
                          <s-table-header>Vendor</s-table-header>
                          <s-table-header>Type</s-table-header>
                          <s-table-header>Status</s-table-header>
                          <s-table-header>Check</s-table-header>
                        </s-table-header-row>
                        <s-table-body>
                          {pageRows.map((p) => (
                            <s-table-row key={p.id}>
                              <s-table-cell>{p.title}</s-table-cell>
                              <s-table-cell>{p.vendor || "—"}</s-table-cell>
                              <s-table-cell>{p.productType || "—"}</s-table-cell>
                              <s-table-cell>
                                <s-badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{STATUS_LABEL[p.status] ?? p.status}</s-badge>
                              </s-table-cell>
                              <s-table-cell>
                                <s-button onClick={() => choose(p.numericId)}>Check</s-button>
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
                  </>
                ) : null}
              </s-stack>
            </s-section>
          ) : (
            <div>
              <s-button icon="arrow-left" onClick={back}>
                Back to the list
              </s-button>
            </div>
          )}

          {state.status === "loading" ? (
            <s-section heading="Reading the product">
              <Loading message="Reading the product from Shopify…" />
            </s-section>
          ) : null}
          {state.status === "error" ? (
            <s-banner tone="critical" heading="Could not read the product">
              <s-paragraph>{state.message}</s-paragraph>
              <s-button slot="secondary-actions" onClick={() => setNonce(nonce + 1)}>
                Try again
              </s-button>
            </s-banner>
          ) : null}
          {state.status === "ready" && !state.detail ? <s-banner tone="warning" heading="This product was not found. It may have been deleted." /> : null}
          {state.status === "ready" && state.detail && check ? (
            <CheckResult detail={state.detail} check={check} onRefresh={() => setNonce(nonce + 1)} />
          ) : null}
        </s-stack>
      </PageBody>
    </s-page>
  );
}

function CheckResult({ detail, check, onRefresh }: { detail: ProductDetail; check: ProductCheck; onRefresh: () => void }) {
  const blockedCountries = check.countries.filter((c) => c.result === "cannot");
  return (
    <>
      <s-section heading={detail.title}>
        <s-stack gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-badge tone={detail.status === "ACTIVE" ? "success" : "neutral"}>{detail.status === "ACTIVE" ? "Active" : detail.status === "DRAFT" ? "Draft" : "Archived"}</s-badge>
            <s-link href={`shopify://admin/products/${detail.numericId}`} target="_blank">
              Open in Shopify
            </s-link>
            <s-button variant="tertiary" onClick={onRefresh}>
              Read again
            </s-button>
          </s-stack>
          <s-banner tone={check.headline.tone === "neutral" ? "info" : check.headline.tone} heading={check.headline.text}>
            {blockedCountries.length > 0 ? (
              <s-paragraph>{`Customers in ${summarizeCodes(blockedCountries.map((c) => c.code), 8)} can see it but cannot check out.`}</s-paragraph>
            ) : null}
          </s-banner>
          {check.notes.map((n, i) => (
            <s-banner key={i} tone="warning" heading={n} />
          ))}
        </s-stack>
      </s-section>

      <s-section heading="1 · Markets">
        <s-table>
          <s-table-header-row>
            <s-table-header>Market</s-table-header>
            <s-table-header>Product active</s-table-header>
            <s-table-header>Published in market</s-table-header>
            <s-table-header>Checkout</s-table-header>
            <s-table-header>Result</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {check.markets.map((m) => (
              <s-table-row key={m.marketId}>
                <s-table-cell>{m.name}</s-table-cell>
                <s-table-cell>{yes(detail.status === "ACTIVE")}</s-table-cell>
                <s-table-cell>{yes(m.published)}</s-table-cell>
                <s-table-cell>
                  {m.ships === "all" ? (
                    <s-badge tone="success">All countries</s-badge>
                  ) : m.ships === "none" ? (
                    <s-badge tone="critical">None</s-badge>
                  ) : (
                    <s-badge tone="warning">{`Blocks ${summarizeCodes(m.blocked, 3)}`}</s-badge>
                  )}
                </s-table-cell>
                <s-table-cell>
                  <s-badge tone={RESULT[m.result].tone}>{RESULT[m.result].label}</s-badge>
                  {m.reason ? (
                    <>
                      <br />
                      <s-text color="subdued">{m.reason}</s-text>
                    </>
                  ) : null}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="2 · Countries">
        <s-table>
          <s-table-header-row>
            <s-table-header>Country</s-table-header>
            <s-table-header>Market</s-table-header>
            <s-table-header>Visible</s-table-header>
            <s-table-header>Can check out</s-table-header>
            <s-table-header>Result</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {[...check.countries]
              .sort((a, b) => order(a.result) - order(b.result) || a.name.localeCompare(b.name))
              .map((c) => (
                <s-table-row key={`${c.market}-${c.code}`}>
                  <s-table-cell>{c.name}</s-table-cell>
                  <s-table-cell>{c.market}</s-table-cell>
                  <s-table-cell>{yes(c.visible)}</s-table-cell>
                  <s-table-cell>{yes(c.checkout)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={RESULT[c.result].tone}>{RESULT[c.result].label}</s-badge>
                    {c.reason && c.result === "cannot" ? (
                      <>
                        <br />
                        <s-text color="subdued">{c.reason}</s-text>
                      </>
                    ) : null}
                  </s-table-cell>
                </s-table-row>
              ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading="3 · Catalogues">
        {check.catalogs.length === 0 ? (
          <s-paragraph color="subdued">No market has a catalogue.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Catalogue</s-table-header>
              <s-table-header>Market</s-table-header>
              <s-table-header>Product is in it</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {check.catalogs.map((c) => (
                <s-table-row key={c.id}>
                  <s-table-cell>{c.title}</s-table-cell>
                  <s-table-cell>{c.market}</s-table-cell>
                  <s-table-cell>{yes(c.inIt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="4 · Shipping profiles">
        <s-table>
          <s-table-header-row>
            <s-table-header>Profile</s-table-header>
            <s-table-header>This product's variants</s-table-header>
            <s-table-header>Ships to</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {check.profiles.map((p) => (
              <s-table-row key={p.key}>
                <s-table-cell>
                  {p.name}
                  {p.isGeneral ? <s-text color="subdued"> (default)</s-text> : null}
                </s-table-cell>
                <s-table-cell>{p.variants > 0 ? <s-badge tone="info">{`${p.variants} variant${p.variants === 1 ? "" : "s"}`}</s-badge> : <s-text color="subdued">—</s-text>}</s-table-cell>
                <s-table-cell>
                  {p.restOfWorld ? `${summarizeCodes(p.ships, 4)} + rest of world` : p.ships.length > 0 ? summarizeCodes(p.ships, 6) : "No countries"}
                  {p.noRateZones.length > 0 ? (
                    <>
                      <br />
                      <s-text color="subdued">{`Zone without rates: ${p.noRateZones.join(", ")}`}</s-text>
                    </>
                  ) : null}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {check.split ? (
        <s-section heading="5 · Variants (they are in different profiles)">
          <s-table>
            <s-table-header-row>
              <s-table-header>Variant</s-table-header>
              <s-table-header>Profile</s-table-header>
              {check.markets.map((m) => (
                <s-table-header key={m.marketId}>{m.name}</s-table-header>
              ))}
            </s-table-header-row>
            <s-table-body>
              {check.variants.map((v) => (
                <s-table-row key={v.id}>
                  <s-table-cell>
                    {v.title}
                    {v.sku ? <s-text color="subdued">{` · ${v.sku}`}</s-text> : null}
                  </s-table-cell>
                  <s-table-cell>{v.profileName}</s-table-cell>
                  {check.markets.map((m) => {
                    const s = v.perMarket[m.marketId];
                    return (
                      <s-table-cell key={m.marketId}>
                        <s-badge tone={s === "all" ? "success" : s === "none" ? "critical" : "warning"}>
                          {s === "all" ? "Ships" : s === "none" ? "No" : "Some"}
                        </s-badge>
                      </s-table-cell>
                    );
                  })}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ) : null}
    </>
  );
}

const order = (r: Result) => ({ cannot: 0, partial: 1, buy: 2, hidden: 3 })[r];
