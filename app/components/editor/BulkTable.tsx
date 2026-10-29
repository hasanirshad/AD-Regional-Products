import { memo, useRef, useState } from "react";
import type { Column, Sort } from "../../lib/editor/bulk";
import { STATUS_LABEL } from "../../lib/editor/model";
import type { ProductRow } from "../../lib/types";
import { previewText } from "../../lib/editor/richHtml";
import { toEditable } from "../../lib/editor/richDom";
import { Dialog } from "./Dialog";
import { RichTextEditor } from "./RichTextEditor";
import { TextBox } from "./TextBox";

const tone = (status: string) => (status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral");

type CellProps = {
  col: Column;
  productId: string;
  productTitle: string;
  /** The description in the main language, when its column is in the table (shown beside a translation). */
  sourceHtml: string | null;
  text: string;
  error: string | null;
  edited: boolean;
  loaded: boolean;
  noVariant: boolean;
  set: (col: Column, productId: string, text: string) => void;
};

/** A description cell: the words as a short preview, and a button that opens the visual editor. */
function RichCell({ col, productId, productTitle, sourceHtml, text, error, edited, set }: Pick<CellProps, "col" | "productId" | "productTitle" | "sourceHtml" | "text" | "error" | "edited" | "set">) {
  const [open, setOpen] = useState(false);
  const draft = useRef(text);
  const preview = previewText(text, 110);
  const translation = col.group === "Translations";
  return (
    <>
      <s-stack gap="small-200">
        <s-text color={preview ? undefined : "subdued"}>{preview || (translation ? "Missing" : "—")}</s-text>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-button
            variant="tertiary"
            accessibilityLabel={`Edit ${col.label} for ${productTitle}`}
            onClick={() => {
              draft.current = text;
              setOpen(true);
            }}
          >
            Edit
          </s-button>
          {edited ? <s-badge tone="info">Edited</s-badge> : null}
        </s-stack>
        {error ? <s-text color="subdued">{error}</s-text> : null}
      </s-stack>
      {open ? (
        <Dialog
          heading={`${col.label} · ${productTitle}`}
          maxWidth={820}
          onClose={() => setOpen(false)}
          footer={
            <s-stack direction="inline" gap="small-200" justifyContent="end">
              <s-button onClick={() => setOpen(false)}>Cancel</s-button>
              <s-button
                variant="primary"
                onClick={() => {
                  if (draft.current !== text) set(col, productId, draft.current);
                  setOpen(false);
                }}
              >
                Use this text
              </s-button>
            </s-stack>
          }
        >
          <s-stack gap="base">
            {translation && sourceHtml ? (
              <details>
                <summary style={{ cursor: "pointer" }}>Source text (main language)</summary>
                <div style={{ maxHeight: 200, overflow: "auto", padding: 8 }} dangerouslySetInnerHTML={{ __html: toEditable(sourceHtml).html }} />
                <s-button variant="tertiary" onClick={() => { draft.current = sourceHtml; set(col, productId, sourceHtml); setOpen(false); }}>
                  Copy the source here and close
                </s-button>
              </details>
            ) : null}
            <RichTextEditor label={`${col.label} for ${productTitle}`} value={text} minHeight={260} onChange={(html) => (draft.current = html)} />
          </s-stack>
        </Dialog>
      ) : null}
    </>
  );
}

const Cell = memo(function Cell({ col, productId, productTitle, sourceHtml, text, error, edited, loaded, noVariant, set }: CellProps) {
  if (!loaded) return <s-text color="subdued">…</s-text>;
  if (noVariant) return <s-text color="subdued">Several variants</s-text>;
  if (!col.editable) {
    const shown = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    return <s-text color="subdued">{shown || "—"}</s-text>;
  }
  if (col.field === "descriptionHtml") return <RichCell col={col} productId={productId} productTitle={productTitle} sourceHtml={sourceHtml} text={text} error={error} edited={edited} set={set} />;
  return (
    <TextBox
      label={col.label}
      hideLabel
      value={text}
      error={error}
      multiline={col.input === "longtext"}
      rows={2}
      placeholder={edited ? undefined : col.group === "Translations" ? "Missing" : undefined}
      onChange={(next) => set(col, productId, next)}
    />
  );
});

/** The table: one row per product, one column per chosen field. Click a heading to sort; type in a cell to change it. */
export function BulkTable({
  rows,
  columns,
  sort,
  onSort,
  textOf,
  errorOf,
  editedOf,
  loadedOf,
  noVariant,
  set,
}: {
  rows: ProductRow[];
  columns: Column[];
  sort: Sort | null;
  onSort: (column: string) => void;
  textOf: (col: Column, productId: string) => string;
  errorOf: (col: Column, productId: string) => string | null;
  editedOf: (col: Column, productId: string) => boolean;
  loadedOf: (col: Column, productId: string) => boolean;
  noVariant: (col: Column, productId: string) => boolean;
  set: (col: Column, productId: string, text: string) => void;
}) {
  const head = (id: string, label: string, hint?: string, key: string = id) => (
    <s-table-header key={key}>
      <s-stack gap="small-100">
        <s-button variant="tertiary" onClick={() => onSort(id)} accessibilityLabel={`Sort by ${label}`}>
          {`${label}${sort?.column === id ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}`}
        </s-button>
        {hint ? <s-text color="subdued">{hint}</s-text> : null}
      </s-stack>
    </s-table-header>
  );
  const sourceCol = columns.find((c) => c.group === "Product" && c.field === "descriptionHtml") ?? null;
  return (
    <div style={{ overflowX: "auto" }}>
      <s-table>
        <s-table-header-row>
          {head("p:title", "Product", undefined, "row-product")}
          {columns.map((c) => head(c.id, c.label, c.group === "Metafields" && c.note ? c.note.split(" · ")[0] : undefined))}
        </s-table-header-row>
        <s-table-body>
          {rows.map((r) => (
            <s-table-row key={r.id}>
              <s-table-cell>
                <s-stack gap="small-100">
                  <s-text type="strong">{r.title}</s-text>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text color="subdued">{r.handle}</s-text>
                    <s-badge tone={tone(r.status)}>{STATUS_LABEL[r.status] ?? r.status}</s-badge>
                  </s-stack>
                </s-stack>
              </s-table-cell>
              {columns.map((c) => (
                <s-table-cell key={c.id}>
                  <Cell
                    col={c}
                    productId={r.id}
                    productTitle={r.title}
                    sourceHtml={c.group === "Translations" && c.field === "descriptionHtml" && sourceCol ? textOf(sourceCol, r.id) : null}
                    text={textOf(c, r.id)}
                    error={errorOf(c, r.id)}
                    edited={editedOf(c, r.id)}
                    loaded={loadedOf(c, r.id)}
                    noVariant={noVariant(c, r.id)}
                    set={set}
                  />
                </s-table-cell>
              ))}
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </div>
  );
}

