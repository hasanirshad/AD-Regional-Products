import { useEffect, useState } from "react";
import { BulkFilterPanel } from "../components/editor/BulkFilterPanel";
import { BulkTable } from "../components/editor/BulkTable";
import { ColumnChooser } from "../components/editor/BulkColumns";
import { PasteDialog } from "../components/editor/BulkPaste";
import { ChangesBar } from "../components/editor/ChangesBar";
import { ReviewScreen } from "../components/editor/ReviewScreen";
import { VariantBulk } from "../components/editor/VariantBulk";
import { UndoBar } from "../components/editor/UndoBar";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { ScopeBanner } from "../components/ScopeBanner";
import { tableToTsv, targetOf, type Column, type PastePlan } from "../lib/editor/bulk";
import { targetKey } from "../lib/editor/model";
import { onChecked } from "../lib/dom";
import { PAGE_SIZE, QUICK } from "./bulk-state";
import type { BulkMode } from "./bulk-variants-state";
import { useStartEditor } from "./editor-state";
import { useStartProducts } from "./products-state";
import { useAppState } from "./state";


// Bulk edit: many products in one table. Choose the columns (fields and languages), filter, sort, type in cells or paste
// from a spreadsheet, review every old and new value, then confirm once. Reading is free; nothing is written before that.
export default function BulkEdit() {
  const { products, editor: shared, bulk, variantBulk: vb, shop } = useAppState();
  useStartProducts(products);
  useStartEditor(shared, ["info", "productDefs", "variantDefs", "settings"]);
  const [choosing, setChoosing] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [reviewing, setReviewing] = useState<"save" | "undo" | null>(null);
  // Which mode the review belongs to: the Undo and the review of changes both go back to it.
  const [reviewMode, setReviewMode] = useState<BulkMode>("products");
  const variants = vb.mode === "variants";
  const startReview = (kind: "save" | "undo") => {
    setReviewMode(vb.mode);
    setReviewing(kind);
  };
  const [notice, setNotice] = useState("");
  const { columns } = bulk;
  const defs = shared.productDefs.data ?? [];

  // The collections list is read once, for the Collection filter.
  useEffect(() => {
    bulk.collections.load();
  }, [bulk.collections.load]); // eslint-disable-line react-hooks/exhaustive-deps

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
            edit={reviewMode === "variants" ? vb : bulk}
            shared={shared}
            products={products}
            finishLabel="Back to the table"
            onClose={(_saved, appliedIds) => {
              setReviewing(null);
              if (appliedIds.length) {
                setNotice("");
                if (reviewMode === "variants") {
                  vb.discard(appliedIds);
                  vb.reread();
                } else {
                  bulk.discard(appliedIds);
                  bulk.reread(appliedIds);
                }
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
          <UndoBar shared={shared} onUndo={() => startReview("undo")} />
          <s-section>
            <s-stack gap="small-200">
              <s-switch
                label="Edit variants"
                details="Off: one row per product. On: choose products, then edit their variants (price, SKU, metafields and their translations)."
                checked={variants || undefined}
                ref={onChecked((on) => vb.setMode(on ? "variants" : "products"))}
              />
              {variants && Object.keys(bulk.edits).length > 0 ? <s-text color="subdued">{`${Object.keys(bulk.edits).length} unsaved product change${Object.keys(bulk.edits).length === 1 ? "" : "s"} are kept. Switch this off to review them.`}</s-text> : null}
              {!variants && Object.keys(vb.edits).length > 0 ? <s-text color="subdued">{`${Object.keys(vb.edits).length} unsaved variant change${Object.keys(vb.edits).length === 1 ? "" : "s"} are kept. Switch this on to review them.`}</s-text> : null}
            </s-stack>
          </s-section>
          <ChangesBar edits={variants ? vb.edits : bulk.edits} built={variants ? vb.built : bulk.built} onReview={() => startReview("save")} onDiscard={variants ? vb.discardAll : bulk.discardAll} />
          {notice && Object.keys(variants ? vb.edits : bulk.edits).length > 0 ? (
            <s-banner tone="success" dismissible onDismiss={() => setNotice("")}>
              <s-paragraph>{notice}</s-paragraph>
            </s-banner>
          ) : null}

          {variants ? <VariantBulk vb={vb} bulk={bulk} shared={shared} products={products} /> : null}
          {variants ? null : (
          <>
          <s-section heading="Columns and filters">
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">Columns</s-text>
                <s-text color="subdued">{columns.map((c) => c.label).join(" · ") || "None"}</s-text>
              </s-stack>
              <s-stack direction="inline" gap="small-200">
                <s-button disabled={shared.productDefs.status === "loading" || (!shared.ready && shared.info.status !== "error") || undefined} onClick={() => setChoosing(true)}>
                  Choose columns
                </s-button>
                <s-button disabled={columns.length === 0 || bulk.rows.length === 0 || undefined} onClick={() => setPasting(true)}>
                  Paste from a spreadsheet
                </s-button>
              </s-stack>
              {shared.info.status === "error" ? <s-text tone="critical">{`Languages could not be read: ${shared.info.error}`}</s-text> : null}
              {shared.productDefs.status === "error" ? <s-text tone="critical">{`Metafield definitions could not be read: ${shared.productDefs.error}`}</s-text> : null}
              <BulkFilterPanel bulk={bulk} shared={shared} products={products} />
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

