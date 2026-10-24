import { useMemo, useState } from "react";
import { FilterBar } from "../components/FilterBar";
import { Loading } from "../components/Loading";
import { MoveReview } from "../components/MoveReview";
import { PageBody } from "../components/PageBody";
import { ScopeBanner } from "../components/ScopeBanner";
import { SelectField } from "../components/SelectField";
import { onChecked } from "../lib/dom";
import {
  activeChips,
  ANY,
  applyFilters,
  filterOptions,
  NO_FILTERS,
  NONE,
} from "../lib/filter";
import { GENERAL as GENERAL_KEY, makeShippers } from "../lib/overview";
import type { Filters, ProductRow } from "../lib/types";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";

const PAGE_SIZE = 40;

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };

function StatusBadge({ status }: { status: string }) {
  const tone = status === "ACTIVE" ? "success" : "neutral";
  return <s-badge tone={tone}>{STATUS_LABEL[status] ?? status}</s-badge>;
}

export default function Products() {
  const { shop, profiles, markets, products, ui, refresh } = useAppState();
  useStartProducts(products);

  const { filters, setFilters, selected, setSelected, page, setPage } = ui;
  const [target, setTarget] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const shippers = useMemo(() => makeShippers(profiles), [profiles]);

  const options = useMemo(() => filterOptions(products.rows), [products.rows]);
  const filtered = useMemo(
    () => applyFilters(products.rows, filters, products.membership),
    [products.rows, filters, products.membership],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageAllSelected = pageRows.length > 0 && pageRows.every((p) => selected.has(p.id));

  const profileName = (id: string | undefined) => shippers.find((s) => s.key === id)?.name;
  // Every shipping profile besides General can hold products.
  const profileChoices = shippers.filter((s) => s.kind === "profile");

  const chips = activeChips(filters, {
    catalogs: options.catalogs,
    profiles: profileChoices.map((s) => ({ id: s.key, name: s.name })),
  });
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });

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

  const heading = `Products · ${shop.name}`;

  if (products.status === "idle" || products.status === "loading") {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <s-section heading="Products">
            <Loading
              message={
                products.loaded > 0
                  ? `Loading products… ${products.loaded} so far`
                  : "Loading products…"
              }
            />
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

  const targetShipper = shippers.find((s) => s.key === target);
  if (reviewing && targetShipper) {
    return (
      <s-page heading={heading} inlineSize="large">
        <PageBody>
          <MoveReview
            products={products.rows.filter((p) => selected.has(p.id))}
            membership={products.membership}
            target={targetShipper}
            shippers={shippers}
            markets={markets}
            onBack={() => setReviewing(false)}
            onFinished={() => {
              setReviewing(false);
              setTarget("");
              setSelected(() => new Set());
              void refresh();
              products.reload();
            }}
          />
        </PageBody>
      </s-page>
    );
  }

  return (
    <s-page heading={heading} inlineSize="large">
      <PageBody>
        <s-stack gap="large-100">
          <ScopeBanner scope={products.scope} count={products.rows.length} onChange={products.setScope} />
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
                <s-heading>Product</s-heading>
                <SelectField
                  label="Status"
                  value={filters.status}
                  onChange={(status) => set({ status })}
                  options={[
                    { value: "", label: "Any status" },
                    ...options.statuses.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s })),
                  ]}
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
                <s-heading>Where it is sold</s-heading>
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
                <SelectField
                  label="Profile"
                  value={filters.profile}
                  onChange={(profile) => set({ profile })}
                  options={[
                    { value: "", label: "Any" },
                    { value: NONE, label: "General (no profile)" },
                    ...profileChoices.map((s) => ({ value: s.key, label: s.name })),
                  ]}
                />
              </FilterBar>

              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text color="subdued">
                  {filtered.length} of {products.rows.length} products · {selected.size} selected
                </s-text>
                {filtered.length > 0 && selected.size < filtered.length ? (
                  <s-button
                    variant="tertiary"
                    onClick={() => setSelected(() => new Set(filtered.map((p) => p.id)))}
                  >
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
              </s-stack>

              {selected.size > 0 ? (
                <s-stack gap="small-100">
                  <s-stack direction="inline" gap="base" alignItems="end">
                    <SelectField
                      label={`Move ${selected.size} selected to`}
                      value={target}
                      onChange={setTarget}
                      options={[
                        { value: "", label: "Choose a shipping profile" },
                        ...profileChoices.map((s) => ({ value: s.key, label: s.name })),
                        { value: GENERAL_KEY, label: "General (no profile)" },
                      ]}
                    />
                    <s-button variant="primary" onClick={() => setReviewing(true)} disabled={!target || undefined}>
                      Review move
                    </s-button>
                  </s-stack>
                  {!target ? <s-text color="subdued">Step 1 of 3: choose the shipping profile to move the selected products into. You review everything before anything changes.</s-text> : null}
                  {profileChoices.length === 0 ? (
                    <s-text color="subdued">This store has no shipping profile besides General. Create one in Shopify under Settings → Shipping.</s-text>
                  ) : null}
                </s-stack>
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
                    <s-table-header>Catalogues</s-table-header>
                    <s-table-header>Profile</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {pageRows.map((p) => (
                      <ProductTableRow
                        key={p.id}
                        p={p}
                        checked={selected.has(p.id)}
                        onCheck={(on) => toggleOne(p.id, on)}
                        current={profileName(products.membership[p.id])}
                      />
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

function ProductTableRow({
  p,
  checked,
  onCheck,
  current,
}: {
  p: ProductRow;
  checked: boolean;
  onCheck: (on: boolean) => void;
  current: string | undefined;
}) {
  const sub = [p.vendor, p.productType].filter(Boolean).join(" · ");
  return (
    <s-table-row>
      <s-table-cell>
        <s-checkbox
          label={`Select ${p.title}`}
          labelAccessibilityVisibility="exclusive"
          checked={checked || undefined}
          ref={onChecked(onCheck)}
        />
      </s-table-cell>
      <s-table-cell>
        <s-link href={`shopify://admin/products/${p.numericId}`} target="_blank">
          {p.title}
        </s-link>
        {sub ? (
          <>
            <br />
            <s-text color="subdued">{sub}</s-text>
          </>
        ) : null}
      </s-table-cell>
      <s-table-cell>
        <StatusBadge status={p.status} />
      </s-table-cell>
      <s-table-cell>
        {p.catalogs.length === 0 ? (
          <s-badge tone="warning">None</s-badge>
        ) : (
          <s-stack direction="inline" gap="small-300">
            {p.catalogs.map((c) => (
              <s-badge key={c.id} tone="neutral">
                {c.title}
              </s-badge>
            ))}
          </s-stack>
        )}
      </s-table-cell>
      <s-table-cell>
        {current ?? "—"}
      </s-table-cell>
    </s-table-row>
  );
}
