import { useEffect, useMemo, useState } from "react";
import { BulkTable } from "../components/editor/BulkTable";
import { ColumnChooser } from "../components/editor/BulkColumns";
import { PasteDialog } from "../components/editor/BulkPaste";
import { ChangesBar } from "../components/editor/ChangesBar";
import { ReviewScreen } from "../components/editor/ReviewScreen";
import { UndoBar } from "../components/editor/UndoBar";
import { FilterBar } from "../components/FilterBar";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { ScopeBanner } from "../components/ScopeBanner";
import { SelectField } from "../components/SelectField";
import { activeFilterCount, NO_BULK_FILTERS, tableToTsv, targetOf, type BulkFilters, type Column, type PastePlan } from "../lib/editor/bulk";
import { filterOptions } from "../lib/filter";
import { targetKey } from "../lib/editor/model";
import { PAGE_SIZE, QUICK } from "./bulk-state";
import { useStartEditor } from "./editor-state";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };
const ANY = "";

// Bulk edit: many products in one table. Choose the columns (fields and languages), filter, sort, type in cells or paste
// from a spreadsheet, review every old and new value, then confirm once. Reading is free; nothing is written before that.
export default function BulkEdit() {
  const { products, editor: shared, bulk, shop } = useAppState();
  useStartProducts(products);
  useStartEditor(shared, ["info", "productDefs", "settings"]);
  const [choosing, setChoosing] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [reviewing, setReviewing] = useState<"save" | "undo" | null>(null);
  const [notice, setNotice] = useState("");
  const { filters, columns } = bulk;
  const defs = shared.productDefs.data ?? [];

  // The collections list is read once, for the Collection filter.
  useEffect(() => {
    bulk.collections.load();
  }, [bulk.collections.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(() => filterOptions(products.rows), [products.rows]);
  const set = (patch: Partial<BulkFilters>) => bulk.setFilters({ ...filters, ...patch });
  const slotLabel = (key: string) => shared.slots.find((s) => s.key === key)?.label ?? key;
  const defName = (key: string) => defs.find((d) => `${d.namespace}.${d.key}` === key)?.name ?? key;
  const catalogName = (id: string) => options.catalogs.find((c) => c.id === id)?.title ?? "catalogue";

  const chips: { key: string; label: string }[] = [];
  if (filters.status) chips.push({ key: "status", label: `Status: ${(STATUS_LABEL[filters.status] ?? filters.status).toLowerCase()}` });
  if (filters.vendor) chips.push({ key: "vendor", label: `Vendor: ${filters.vendor}` });
  if (filters.productType) chips.push({ key: "productType", label: `Type: ${filters.productType}` });
  if (filters.tag) chips.push({ key: "tag", label: `Tag: ${filters.tag}` });
  if (filters.collection) chips.push({ key: "collection", label: `Collection: ${bulk.collections.data?.find((c) => c.id === filters.collection)?.title ?? "…"}` });
  if (filters.catalog) chips.push({ key: "catalog", label: `${filters.catalogMode === "in" ? "In" : "Not in"} ${catalogName(filters.catalog)}` });
  if (filters.missingSlot) chips.push({ key: "missingSlot", label: `Missing translation: ${slotLabel(filters.missingSlot)}` });
  if (filters.emptyMetafield) chips.push({ key: "emptyMetafield", label: `Empty: ${defName(filters.emptyMetafield)}` });

  const rows = bulk.rows;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(bulk.page, pages - 1);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const onSort = (column: string) => {
    const cur = bulk.sort;
    bulk.setSort(!cur || cur.column !== column ? { column, dir: "asc" } : cur.dir === "asc" ? { column, dir: "desc" } : null);
    bulk.setPage(0);
  };

  const editKey = (col: Column, id: string): string | null => {
    // The variant of a price cell is known once it has been read; the text lookup below handles it.
    const t = targetOf(col, id, bulk.cellVariant(id));
    return t ? targetKey(t) : null;
  };
  const errorOf = (col: Column, id: string) => {
    const k = editKey(col, id);
    return k ? (bulk.edits[k]?.error ?? null) : null;
  };
  const editedOf = (col: Column, id: string) => {
    const k = editKey(col, id);
    return k ? k in bulk.edits : false;
  };

  const tableText = () => tableToTsv(columns, rows, (r, c) => bulk.textOf(c, r.id));

  if (reviewing) {
    return (
      <s-page heading="Bulk edit" inlineSize="large">
        <PageBody maxWidth={1280}>
          <ReviewScreen
            kind={reviewing}
            edit={bulk}
            shared={shared}
            products={products}
            finishLabel="Back to the table"
            onClose={(_saved, appliedIds) => {
              setReviewing(null);
              if (appliedIds.length) {
                setNotice("");
                bulk.discard(appliedIds);
                bulk.reread(appliedIds);
              }
            }}
          />
        </PageBody>
      </s-page>
    );
  }

  const applyPaste = async (plan: PastePlan) => {
    const ids = [...new Set(plan.edits.map((e) => e.productId))];
    const cols = [...new Map(plan.edits.map((e) => [e.column.id, e.column])).values()];
    await bulk.ensureProducts(ids, cols);
    for (const e of plan.edits) bulk.setCell(e.column, e.productId, e.text);
    setNotice(`${plan.edits.length} pasted cell${plan.edits.length === 1 ? "" : "s"} are in the table as unsaved changes. Review them with the button at the top.`);
  };

  const needsAll = !bulk.all && bulk.inScope > QUICK;
  const loadedOf = bulk.isLoaded;

  return (
    <s-page heading="Bulk edit" inlineSize="large">
      <PageBody maxWidth={1280}>
        <s-stack gap="large-100">
          <UndoBar shared={shared} onUndo={() => setReviewing("undo")} />
          <ChangesBar edits={bulk.edits} built={bulk.built} onReview={() => setReviewing("save")} onDiscard={bulk.discardAll} />
          {notice && Object.keys(bulk.edits).length > 0 ? (
            <s-banner tone="success" dismissible onDismiss={() => setNotice("")}>
              <s-paragraph>{notice}</s-paragraph>
            </s-banner>
          ) : null}

          <s-section heading="Columns and filters">
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">Columns</s-text>
                <s-text color="subdued">{columns.map((c) => c.label).join(" · ") || "None"}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="small-200">
                <s-button disabled={shared.productDefs.status === "loading" || shared.info.status === "loading" || undefined} onClick={() => setChoosing(true)}>
                  Choose columns
                </s-button>
                <s-button disabled={columns.length === 0 || bulk.rows.length === 0 || undefined} onClick={() => setPasting(true)}>
                  Paste from a spreadsheet
                </s-button>
              </s-stack>
              {shared.info.status === "error" ? <s-text tone="critical">{`Languages could not be read: ${shared.info.error}`}</s-text> : null}
              {shared.productDefs.status === "error" ? <s-text tone="critical">{`Metafield definitions could not be read: ${shared.productDefs.error}`}</s-text> : null}
              <FilterBar
                search={filters.search}
                onSearch={(search) => set({ search })}
                placeholder="Search title, handle, vendor, type or tag"
                activeCount={activeFilterCount(filters)}
                chips={chips}
                onRemoveChip={(key) => set({ [key]: "" } as Partial<BulkFilters>)}
                onClear={() => bulk.setFilters(NO_BULK_FILTERS)}
              >
                <SelectField label="Status" value={filters.status} options={[{ value: ANY, label: "Any" }, ...options.statuses.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }))]} onChange={(status) => set({ status })} />
                <SelectField label="Vendor" value={filters.vendor} options={[{ value: ANY, label: "Any" }, ...options.vendors.map((v) => ({ value: v, label: v }))]} onChange={(vendor) => set({ vendor })} />
                <SelectField label="Product type" value={filters.productType} options={[{ value: ANY, label: "Any" }, ...options.types.map((v) => ({ value: v, label: v }))]} onChange={(productType) => set({ productType })} />
                <SelectField label="Tag" value={filters.tag} options={[{ value: ANY, label: "Any" }, ...options.tags.map((v) => ({ value: v, label: v }))]} onChange={(tag) => set({ tag })} />
                <SelectField
                  label="Collection"
                  value={filters.collection}
                  options={[{ value: ANY, label: bulk.collections.status === "loading" ? "Reading collections…" : "Any" }, ...(bulk.collections.data ?? []).map((c) => ({ value: c.id, label: c.title }))]}
                  onChange={(collection) => set({ collection })}
                />
                <SelectField label="Market catalogue" value={filters.catalog} options={[{ value: ANY, label: "Any" }, ...options.catalogs.map((c) => ({ value: c.id, label: c.title }))]} onChange={(catalog) => set({ catalog })} />
                {filters.catalog ? (
                  <SelectField
                    label="Products that are"
                    value={filters.catalogMode}
                    options={[
                      { value: "in", label: "Published in it" },
                      { value: "not", label: "Not published in it" },
                    ]}
                    onChange={(catalogMode) => set({ catalogMode: catalogMode === "not" ? "not" : "in" })}
                  />
                ) : null}
                <SelectField label="Missing translation in" value={filters.missingSlot} options={[{ value: ANY, label: "Any" }, ...shared.slots.map((s) => ({ value: s.key, label: s.label }))]} onChange={(missingSlot) => set({ missingSlot })} />
                <SelectField label="Empty metafield" value={filters.emptyMetafield} options={[{ value: ANY, label: "Any" }, ...defs.map((d) => ({ value: `${d.namespace}.${d.key}`, label: `${d.name} (${d.namespace}.${d.key})` }))]} onChange={(emptyMetafield) => set({ emptyMetafield })} />
              </FilterBar>
              {bulk.collectionError ? <s-text tone="critical">{`The collection could not be read: ${bulk.collectionError}`}</s-text> : null}
            </s-stack>
          </s-section>

          {products.status === "error" ? (
            <s-banner tone="critical" heading="Could not read your products">
              <s-paragraph>{products.error}</s-paragraph>
              <s-button slot="secondary-actions" onClick={products.reload}>
                Try again
              </s-button>
            </s-banner>
          ) : products.status !== "ready" ? (
            <s-section>
              <Loading message={products.loaded > 0 ? `Reading products… ${products.loaded}` : `Reading the products of ${shop.name}…`} />
            </s-section>
          ) : (
            <>
              <ScopeBanner scope={products.scope} count={products.rows.length} onChange={products.setScope} />
              {bulk.progress.busy ? (
                <s-banner tone="info">
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <Loading message={`Reading values… ${bulk.progress.done} of ${bulk.progress.total} products`} />
                    <s-button onClick={bulk.stop}>Stop</s-button>
                  </s-stack>
                </s-banner>
              ) : null}
              {bulk.progress.error ? (
                <s-banner tone="critical" heading="Some values could not be read">
                  <s-paragraph>{bulk.progress.error}</s-paragraph>
                </s-banner>
              ) : null}
              {needsAll ? (
                <s-banner tone="info" heading={`Showing the first ${QUICK} of ${bulk.inScope} products`}>
                  <s-paragraph>You can start now. Sorting by a value, and the missing-translation and empty-metafield filters, look only at the products read so far.</s-paragraph>
                  <s-button slot="secondary-actions" onClick={bulk.loadAll}>
                    {`Load all ${bulk.inScope}`}
                  </s-button>
                </s-banner>
              ) : null}
              {bulk.waiting > 0 && !needsAll ? (
                <s-banner tone="warning">
                  <s-paragraph>{`${bulk.waiting} product${bulk.waiting === 1 ? " has" : "s have"} not been checked for this filter yet.`}</s-paragraph>
                </s-banner>
              ) : null}

              <s-section heading={`${rows.length} product${rows.length === 1 ? "" : "s"}`}>
                <s-stack gap="base">
                  {rows.length === 0 ? (
                    <s-text color="subdued">{bulk.progress.busy ? "Reading…" : "No products match the filters."}</s-text>
                  ) : (
                    <BulkTable
                      rows={pageRows}
                      columns={columns}
                      sort={bulk.sort}
                      onSort={onSort}
                      textOf={bulk.textOf}
                      errorOf={errorOf}
                      editedOf={editedOf}
                      loadedOf={loadedOf}
                      noVariant={bulk.noVariant}
                      set={bulk.setCell}
                    />
                  )}
                  {pages > 1 ? (
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-button disabled={page === 0 || undefined} onClick={() => bulk.setPage(page - 1)}>
                        Previous
                      </s-button>
                      <s-text>{`Page ${page + 1} of ${pages}`}</s-text>
                      <s-button disabled={page >= pages - 1 || undefined} onClick={() => bulk.setPage(page + 1)}>
                        Next
                      </s-button>
                    </s-stack>
                  ) : null}
                </s-stack>
              </s-section>
            </>
          )}
        </s-stack>
        {choosing ? (
          <ColumnChooser
            columns={columns}
            defs={defs}
            slots={shared.slots}
            onClose={() => setChoosing(false)}
            onDone={(cols) => {
              bulk.setColumns(cols);
              setChoosing(false);
            }}
          />
        ) : null}
        {pasting ? <PasteDialog columns={columns} products={products.rows} tableText={tableText} onApply={applyPaste} onClose={() => setPasting(false)} /> : null}
      </PageBody>
    </s-page>
  );
}

