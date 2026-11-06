import { memo, useCallback, useMemo, useState } from "react";
import { Loading } from "../components/Loading";
import { MoveReview } from "../components/MoveReview";
import { PageBody } from "../components/PageBody";
import { ScopeBanner } from "../components/ScopeBanner";
import { SelectField } from "../components/SelectField";
import { SearchFilterBar } from "../components/filters/SearchFilterBar";
import { SelectionLine } from "../components/filters/SelectionLine";
import { onChecked } from "../lib/dom";
import { NONE, type PageSection, type SectionId } from "../lib/filters/filterModel";
import { matchingSelected, selectMatching } from "../lib/filters/selection";
import { GENERAL as GENERAL_KEY, makeShippers } from "../lib/overview";
import type { ProductRow } from "../lib/types";
import { useListFilters } from "./filter-state";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";

const SECTIONS: SectionId[] = ["status", "vendor", "productType", "collection", "tag", "tagNot", "catalog", "market", "variants", "page"];

const PAGE_SIZE = 40;

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };

function StatusBadge({ status }: { status: string }) {
  const tone = status === "ACTIVE" ? "success" : "neutral";
  return <s-badge tone={tone}>{STATUS_LABEL[status] ?? status}</s-badge>;
}

export default function Products() {
  const { shop, profiles, markets, products, ui, collections, refresh } = useAppState();
  useStartProducts(products);

  const { filters, setFilters, selected, setSelected, page, setPage } = ui;
  const [target, setTarget] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const shippers = useMemo(() => makeShippers(profiles), [profiles]);

  // Every shipping profile besides General can hold products.
  const profileChoices = shippers.filter((s) => s.kind === "profile");
  const pageSections = useMemo<PageSection[]>(
    () => [{ key: "profile", label: "Shipping profile", single: true, options: [{ value: NONE, label: "General (no profile)" }, ...profileChoices.map((s) => ({ value: s.key, label: s.name }))] }],
    [profileChoices],
  );
  const context = useMemo(
    () => ({ pageMatch: (p: ProductRow, page: Record<string, string[]>) => (page.profile ?? []).length === 0 || page.profile!.some((v) => (v === NONE ? !products.membership[p.id] : products.membership[p.id] === v)) }),
    [products.membership],
  );
  const extra = useMemo(() => ({ pageSections }), [pageSections]);
  const found = useListFilters({ rows: products.rows, ui, markets, collections, context, options: extra, sections: SECTIONS });
  const filtered = found.list;

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageAllSelected = pageRows.length > 0 && pageRows.every((p) => selected.has(p.id));

  const profileName = (id: string | undefined) => shippers.find((s) => s.key === id)?.name;
  const profileLabel = (productId: string) => {
    const list = products.parts[productId];
    if (list && list.length > 1) return `Split: ${list.map((x) => profileName(x.key) ?? "?").join(" + ")}`;
    return profileName(products.membership[productId]);
  };

  const toggleOne = useCallback(
    (id: string, on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    [setSelected],
  );
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
            parts={products.parts}
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
              <SearchFilterBar filters={filters} onChange={setFilters} sections={SECTIONS} options={found.options} pageTitle="Availability" notes={found.notes} onOpen={found.onOpen} />
              <SelectionLine count={selected.size} onlySelected={found.onlySelected} onOnlySelected={ui.setOnlySelected} onClear={ui.clearSelection} />

              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text color="subdued">
                  {filtered.length} of {products.rows.length} products · {selected.size} selected
                </s-text>
                {!found.onlySelected && found.matching.length > 0 && matchingSelected(selected, found.matching) < found.matching.length ? (
                  <s-button variant="tertiary" onClick={() => setSelected((prev) => selectMatching(prev, found.matching))}>
                    {`Select all ${found.matching.length} matching`}
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
                  <s-paragraph>{found.waiting > 0 ? "No products to show yet." : "No products match these filters."}</s-paragraph>
                  <div>
                    <s-button onClick={ui.clearFilters}>Clear filters</s-button>
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
                    <s-table-header>Details</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {pageRows.map((p) => (
                      <ProductTableRow
                        key={p.id}
                        p={p}
                        checked={selected.has(p.id)}
                        onToggle={toggleOne}
                        current={profileLabel(p.id)}
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

const ProductTableRow = memo(function ProductTableRow({
  p,
  checked,
  onToggle,
  current,
}: {
  p: ProductRow;
  checked: boolean;
  onToggle: (id: string, on: boolean) => void;
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
          ref={onChecked((on) => onToggle(p.id, on))}
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
      <s-table-cell>
        <s-link href={`/check?product=${p.numericId}`}>Check</s-link>
      </s-table-cell>
    </s-table-row>
  );
});
