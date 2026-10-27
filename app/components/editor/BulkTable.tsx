import { memo } from "react";
import type { Column, Sort } from "../../lib/editor/bulk";
import { STATUS_LABEL } from "../../lib/editor/model";
import type { ProductRow } from "../../lib/types";
import { TextBox } from "./TextBox";

const tone = (status: string) => (status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral");

type CellProps = {
  col: Column;
  productId: string;
  text: string;
  error: string | null;
  edited: boolean;
  loaded: boolean;
  noVariant: boolean;
  set: (col: Column, productId: string, text: string) => void;
};

const Cell = memo(function Cell({ col, productId, text, error, edited, loaded, noVariant, set }: CellProps) {
  if (!loaded) return <s-text color="subdued">…</s-text>;
  if (noVariant) return <s-text color="subdued">Several variants</s-text>;
  if (!col.editable) {
    const shown = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    return <s-text color="subdued">{shown || "—"}</s-text>;
  }
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

