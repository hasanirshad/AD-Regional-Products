import { memo, useMemo, useState } from "react";
import { onChecked } from "../../lib/dom";
import { columnsFor, variantMetaColumn, translatableVariantMetafield, VARIANT_FIELDS, MAX_PRODUCTS, type VariantRow } from "../../lib/editor/bulkVariants";
import type { Column } from "../../lib/editor/bulk";
import { STATUS_LABEL } from "../../lib/editor/model";
import { PAGE_SIZE, QUICK, type BulkState } from "../../views/bulk-state";
import type { VariantBulkState } from "../../views/bulk-variants-state";
import { VARIANT_PAGE_SIZE } from "../../views/bulk-variants-state";
import type { EditorShared } from "../../views/editor-state";
import type { ProductsLoad } from "../../views/products-state";
import { Loading } from "../Loading";
import { BulkFilterPanel } from "./BulkFilterPanel";
import { TextBox } from "./TextBox";

const STEPS = ["Choose products", "Choose columns", "Edit variants"] as const;
const tone = (status: string) => (status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral");
const variantName = (title: string) => (title === "Default Title" ? "Default variant" : title);

function Steps({ vb }: { vb: VariantBulkState }) {
  const at = vb.step === "products" ? 0 : vb.step === "columns" ? 1 : 2;
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      {STEPS.map((label, i) => {
        const reachable = i === 0 || (i === 1 && vb.selected.length > 0) || (i === 2 && vb.selected.length > 0 && vb.columns.length > 0);
        return (
          <s-stack key={label} direction="inline" gap="small-200" alignItems="center">
            <s-badge tone={i === at ? "info" : "neutral"}>{String(i + 1)}</s-badge>
            {reachable && i !== at ? (
              <s-button variant="tertiary" onClick={() => vb.setStep(i === 0 ? "products" : i === 1 ? "columns" : "table")}>
                {label}
              </s-button>
            ) : (
              <s-text type={i === at ? "strong" : undefined} color={i === at ? undefined : "subdued"}>
                {label}
              </s-text>
            )}
          </s-stack>
        );
      })}
    </s-stack>
  );
}

// ---------------------------------------------------------------- step 1

function ProductPicker({ vb, bulk, shared, products }: { vb: VariantBulkState; bulk: BulkState; shared: EditorShared; products: ProductsLoad }) {
  const [page, setPage] = useState(0);
  const rows = bulk.rows;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const pageRows = rows.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE);
  const chosen = new Set(vb.selected);
  const visibleChosen = rows.filter((r) => chosen.has(r.id)).length;
  const needsAll = !bulk.all && bulk.inScope > QUICK;

  return (
    <s-stack gap="base">
      <s-section heading="Choose products">
        <s-stack gap="base">
          <s-text color="subdued">Filter the list, then tick the products whose variants you want to edit. Your ticks stay when you change the filters.</s-text>
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
          <Loading message={products.loaded > 0 ? `Reading products… ${products.loaded}` : "Reading the products…"} />
        </s-section>
      ) : (
        <>
          {needsAll ? (
            <s-banner tone="info" heading={`Showing the first ${QUICK} of ${bulk.inScope} products`}>
              <s-paragraph>The missing-translation and empty-metafield filters look only at the products read so far.</s-paragraph>
              <s-button slot="secondary-actions" onClick={bulk.loadAll}>
                {`Load all ${bulk.inScope}`}
              </s-button>
            </s-banner>
          ) : null}
          <s-section heading={`${rows.length} product${rows.length === 1 ? "" : "s"}`}>
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-button onClick={() => vb.select(pageRows.map((r) => r.id))} disabled={pageRows.length === 0 || undefined}>
                  Select this page
                </s-button>
                <s-button onClick={() => vb.select(rows.map((r) => r.id))} disabled={rows.length === 0 || undefined}>
                  {rows.length > MAX_PRODUCTS ? `Select the first ${MAX_PRODUCTS} matching` : `Select all ${rows.length} matching`}
                </s-button>
                <s-button onClick={vb.clearSelection} disabled={vb.selected.length === 0 || undefined}>
                  Clear selection
                </s-button>
                <s-text color="subdued">{`${vb.selected.length} selected${visibleChosen !== vb.selected.length ? ` (${visibleChosen} in this list)` : ""} · most ${MAX_PRODUCTS}`}</s-text>
              </s-stack>
              {rows.length === 0 ? (
                <s-text color="subdued">{bulk.progress.busy ? "Reading…" : "No products match the filters."}</s-text>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <s-table>
                    <s-table-header-row>
                      <s-table-header>Use</s-table-header>
                      <s-table-header>Product</s-table-header>
                      <s-table-header>Status</s-table-header>
                      <s-table-header>Variants</s-table-header>
                    </s-table-header-row>
                    <s-table-body>
                      {pageRows.map((r) => (
                        <s-table-row key={r.id}>
                          <s-table-cell>
                            <s-checkbox label={`Edit the variants of ${r.title}`} checked={chosen.has(r.id) || undefined} ref={onChecked((on) => (on ? vb.select([r.id]) : vb.unselect([r.id])))} />
                          </s-table-cell>
                          <s-table-cell>
                            <s-stack gap="small-100">
                              <s-text type="strong">{r.title}</s-text>
                              <s-text color="subdued">{r.handle}</s-text>
                            </s-stack>
                          </s-table-cell>
                          <s-table-cell>
                            <s-badge tone={tone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</s-badge>
                          </s-table-cell>
                          <s-table-cell>{String(r.variantCount)}</s-table-cell>
                        </s-table-row>
                      ))}
                    </s-table-body>
                  </s-table>
                </div>
              )}
              {pages > 1 ? (
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-button disabled={at === 0 || undefined} onClick={() => setPage(at - 1)}>
                    Previous
                  </s-button>
                  <s-text>{`Page ${at + 1} of ${pages}`}</s-text>
                  <s-button disabled={at >= pages - 1 || undefined} onClick={() => setPage(at + 1)}>
                    Next
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          </s-section>
        </>
      )}

      <s-stack direction="inline" gap="small-200" justifyContent="end">
        <s-button variant="primary" disabled={vb.selected.length === 0 || undefined} onClick={() => vb.setStep("columns")}>
          {`Next: choose columns (${vb.selected.length} product${vb.selected.length === 1 ? "" : "s"})`}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

// ---------------------------------------------------------------- step 2

const FIELD_LABEL: Record<string, string> = { price: "Price", compareAtPrice: "Compare-at price", sku: "SKU", barcode: "Barcode" };

function ColumnPicker({ vb, shared }: { vb: VariantBulkState; shared: EditorShared }) {
  const defs = shared.variantDefs.data ?? [];
  const slots = shared.slots;
  const [fields, setFields] = useState<string[]>(() => vb.columns.filter((c) => c.group === "Variant").map((c) => c.variantField!));
  const [metas, setMetas] = useState<string[]>(() => vb.columns.filter((c) => c.group === "Metafields").map((c) => `${c.namespace}.${c.key}`));
  const [slotKeys, setSlotKeys] = useState<string[]>(() => [...new Set(vb.columns.filter((c) => c.group === "Translations").map((c) => c.slot!))]);
  const [search, setSearch] = useState("");
  const toggle = (list: string[], set: (l: string[]) => void, key: string, on: boolean) => set(on ? (list.includes(key) ? list : [...list, key]) : list.filter((x) => x !== key));

  const q = search.trim().toLowerCase();
  const shownDefs = q ? defs.filter((d) => `${d.name} ${d.namespace}.${d.key}`.toLowerCase().includes(q)) : defs;
  const translatable = defs.filter((d) => metas.includes(`${d.namespace}.${d.key}`) && translatableVariantMetafield(d.type));
  const columns = useMemo(() => columnsFor(fields, metas, slotKeys, defs, slots), [fields, metas, slotKeys, defs, slots]);

  return (
    <s-stack gap="base">
      <s-section heading="Choose columns">
        <s-stack gap="large-100">
          <s-stack gap="small-200">
            <s-text type="strong">Variant fields</s-text>
            <s-text color="subdued">Price and compare-at price are those of your primary market.</s-text>
            {VARIANT_FIELDS.map((f) => (
              <s-checkbox key={f} label={FIELD_LABEL[f] ?? f} checked={fields.includes(f) || undefined} ref={onChecked((on) => toggle(fields, setFields, f, on))} />
            ))}
          </s-stack>

          <s-stack gap="small-200">
            <s-text type="strong">Variant metafields</s-text>
            {shared.variantDefs.status === "loading" ? <Loading message="Reading the variant metafields…" /> : null}
            {shared.variantDefs.status === "error" ? <s-text tone="critical">{`Variant metafields could not be read: ${shared.variantDefs.error}`}</s-text> : null}
            {defs.length === 0 && shared.variantDefs.status === "ready" ? <s-text color="subdued">This store has no variant metafield definitions.</s-text> : null}
            {defs.length > 8 ? <TextBox label="Search metafields" value={search} onChange={setSearch} placeholder="For example length, colour" /> : null}
            {shownDefs.map((d) => {
              const col = variantMetaColumn(d);
              const key = `${d.namespace}.${d.key}`;
              return (
                <s-checkbox
                  key={key}
                  label={`${d.name} · ${col.note ?? key}`}
                  checked={metas.includes(key) || undefined}
                  ref={onChecked((on) => toggle(metas, setMetas, key, on))}
                />
              );
            })}
          </s-stack>

          <s-stack gap="small-200">
            <s-text type="strong">Translations of the chosen metafields</s-text>
            {translatable.length === 0 ? (
              <s-text color="subdued">Tick a text, multi-line text or link metafield above to translate it. Lists, numbers and other types cannot be translated.</s-text>
            ) : (
              <>
                <s-text color="subdued">
                  {`Type or paste the text for ${translatable.map((d) => d.name).join(", ")}. Nothing is translated for you. The languages and market adaptations are the ones in Block settings, Languages and adaptations.`}
                </s-text>
                {slots.length === 0 ? <s-text color="subdued">No other language is set up in this store.</s-text> : null}
                {slots.map((s) => (
                  <s-checkbox key={s.key} label={s.label} checked={slotKeys.includes(s.key) || undefined} ref={onChecked((on) => toggle(slotKeys, setSlotKeys, s.key, on))} />
                ))}
                <s-text color="subdued">A translation belongs to the saved value of the metafield. A variant that has no value yet shows “Save the value first”: save it, then translate it.</s-text>
              </>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      <s-stack direction="inline" gap="small-200" justifyContent="space-between">
        <s-button onClick={() => vb.setStep("products")}>Back to products</s-button>
        <s-button
          variant="primary"
          disabled={columns.length === 0 || undefined}
          onClick={() => {
            vb.setColumns(columns);
            vb.setStep("table");
          }}
        >
          {`Show ${columns.length} column${columns.length === 1 ? "" : "s"} for ${vb.selected.length} product${vb.selected.length === 1 ? "" : "s"}`}
        </s-button>
      </s-stack>
    </s-stack>
  );
}

// ---------------------------------------------------------------- step 3

type CellProps = {
  col: Column;
  row: VariantRow;
  text: string;
  blocker: string | null;
  error: string | null;
  edited: boolean;
  loaded: boolean;
  set: (col: Column, row: VariantRow, text: string) => void;
};

const Cell = memo(function Cell({ col, row, text, blocker, error, edited, loaded, set }: CellProps) {
  if (!loaded) return <s-text color="subdued">…</s-text>;
  if (blocker) return <s-text color="subdued">{blocker}</s-text>;
  return (
    <TextBox
      label={`${col.label} · ${variantName(row.title)}`}
      hideLabel
      value={text}
      error={error}
      multiline={col.input === "longtext"}
      rows={2}
      placeholder={edited ? undefined : col.group === "Translations" ? "Missing" : undefined}
      onChange={(next) => set(col, row, next)}
    />
  );
});

function VariantTable({ vb }: { vb: VariantBulkState }) {
  const pages = Math.max(1, Math.ceil(vb.rows.length / VARIANT_PAGE_SIZE));
  const at = Math.min(vb.page, pages - 1);
  const pageRows = vb.rows.slice(at * VARIANT_PAGE_SIZE, (at + 1) * VARIANT_PAGE_SIZE);
  return (
    <s-stack gap="base">
      <div style={{ overflowX: "auto" }}>
        <s-table>
          <s-table-header-row>
            <s-table-header>Product</s-table-header>
            <s-table-header>Variant</s-table-header>
            {vb.columns.map((c) => (
              <s-table-header key={c.id}>
                <s-stack gap="small-100">
                  <s-text type="strong">{c.label}</s-text>
                  {c.group === "Metafields" && c.note ? <s-text color="subdued">{c.note.split(" · ")[0]}</s-text> : null}
                </s-stack>
              </s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {pageRows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>
                  <s-stack gap="small-100">
                    <s-text type="strong">{r.productTitle}</s-text>
                    <s-text color="subdued">{r.productHandle}</s-text>
                  </s-stack>
                </s-table-cell>
                <s-table-cell>{variantName(r.title)}</s-table-cell>
                {vb.columns.map((c) => (
                  <s-table-cell key={c.id}>
                    <Cell col={c} row={r} text={vb.textOf(c, r)} blocker={vb.blockerOf(c, r)} error={vb.errorOf(c, r)} edited={vb.editedOf(c, r)} loaded={vb.loadedOf(c, r)} set={vb.setCell} />
                  </s-table-cell>
                ))}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </div>
      {pages > 1 ? (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-button disabled={at === 0 || undefined} onClick={() => vb.setPage(at - 1)}>
            Previous
          </s-button>
          <s-text>{`Page ${at + 1} of ${pages}`}</s-text>
          <s-button disabled={at >= pages - 1 || undefined} onClick={() => vb.setPage(at + 1)}>
            Next
          </s-button>
        </s-stack>
      ) : null}
    </s-stack>
  );
}

function TableStep({ vb }: { vb: VariantBulkState }) {
  const products = new Set(vb.rows.map((r) => r.productId)).size;
  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small-200" justifyContent="space-between">
        <s-stack direction="inline" gap="small-200">
          <s-button onClick={() => vb.setStep("products")}>Change products</s-button>
          <s-button onClick={() => vb.setStep("columns")}>Change columns</s-button>
        </s-stack>
        <s-text color="subdued">{`${vb.rows.length} variant${vb.rows.length === 1 ? "" : "s"} in ${products} product${products === 1 ? "" : "s"}`}</s-text>
      </s-stack>
      {vb.progress.busy ? (
        <s-banner tone="info">
          <s-stack direction="inline" gap="base" alignItems="center">
            <Loading message={vb.progress.total > 0 && vb.progress.done > 0 ? `Reading values… ${vb.progress.done} of ${vb.progress.total} variants` : "Reading the variants…"} />
            <s-button onClick={vb.stop}>Stop</s-button>
          </s-stack>
        </s-banner>
      ) : null}
      {vb.progress.error ? (
        <s-banner tone="critical" heading="Some values could not be read">
          <s-paragraph>{vb.progress.error}</s-paragraph>
        </s-banner>
      ) : null}
      {vb.truncated.length > 0 ? (
        <s-banner tone="warning" heading="Some products have more variants than the table shows">
          <s-paragraph>{`Only the first 250 variants are shown for: ${vb.truncated.join(", ")}.`}</s-paragraph>
        </s-banner>
      ) : null}
      <s-section heading="Variants">
        {vb.rows.length === 0 ? <s-text color="subdued">{vb.progress.busy ? "Reading…" : "These products have no variants."}</s-text> : <VariantTable vb={vb} />}
      </s-section>
    </s-stack>
  );
}

/** Variants mode of Bulk edit: choose products, choose columns, then edit one row per variant. */
export function VariantBulk({ vb, bulk, shared, products }: { vb: VariantBulkState; bulk: BulkState; shared: EditorShared; products: ProductsLoad }) {
  return (
    <s-stack gap="base">
      <Steps vb={vb} />
      {vb.step === "products" ? <ProductPicker vb={vb} bulk={bulk} shared={shared} products={products} /> : null}
      {vb.step === "columns" ? <ColumnPicker vb={vb} shared={shared} /> : null}
      {vb.step === "table" ? <TableStep vb={vb} /> : null}
    </s-stack>
  );
}
