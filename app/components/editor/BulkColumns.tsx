import { useMemo, useState } from "react";
import { PRODUCT_COLUMN_FIELDS, TRANSLATABLE_FIELDS, VARIANT_COLUMN_FIELDS, metafieldColumn, productColumn, translationColumn, variantColumn, type Column } from "../../lib/editor/bulk";
import type { Definition } from "../../lib/editor/load";
import type { Slot } from "../../lib/editor/locales";
import { onChecked } from "../../lib/dom";
import { Dialog } from "./Dialog";
import { TextBox } from "./TextBox";

/** Everything that can be a column: product fields, variant fields, a translation of a field in a language, a product metafield. */
export function allColumns(defs: Definition[], slots: Slot[]): Column[] {
  return [
    ...PRODUCT_COLUMN_FIELDS.map(productColumn),
    ...VARIANT_COLUMN_FIELDS.map(variantColumn),
    ...slots.flatMap((s) => TRANSLATABLE_FIELDS.map((f) => translationColumn(f, s.key, s.label))),
    ...defs.map(metafieldColumn),
  ];
}

export function ColumnChooser({ columns, defs, slots, onDone, onClose }: { columns: Column[]; defs: Definition[]; slots: Slot[]; onDone: (cols: Column[]) => void; onClose: () => void }) {
  const candidates = useMemo(() => allColumns(defs, slots), [defs, slots]);
  const [picked, setPicked] = useState<string[]>(columns.map((c) => c.id));
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? (p.includes(id) ? p : [...p, id]) : p.filter((x) => x !== id)));

  const section = (title: string, list: Column[], note?: string) => {
    const shown = q ? list.filter((c) => `${c.label} ${c.note ?? ""}`.toLowerCase().includes(q)) : list;
    if (shown.length === 0) return null;
    return (
      <s-stack gap="small-200">
        <s-text type="strong">{title}</s-text>
        {note ? <s-text color="subdued">{note}</s-text> : null}
        {shown.map((c) => (
          <s-checkbox key={c.id} label={c.group === "Metafields" ? `${c.label} · ${c.note ?? ""}` : c.label} checked={picked.includes(c.id) || undefined} ref={onChecked((on) => toggle(c.id, on))} />
        ))}
      </s-stack>
    );
  };

  const done = () => {
    // Keep the order of the columns already shown, then add the new ones in the order of the list.
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const kept = columns.filter((c) => picked.includes(c.id));
    const known = new Set(kept.map((c) => c.id));
    const added = candidates.filter((c) => picked.includes(c.id) && !known.has(c.id));
    onDone([...kept.map((c) => byId.get(c.id) ?? c), ...added]);
  };

  return (
    <Dialog
      heading="Choose columns"
      onClose={onClose}
      maxWidth={720}
      footer={
        <s-stack direction="inline" gap="small-200" justifyContent="end">
          <s-button onClick={onClose}>Cancel</s-button>
          <s-button variant="primary" disabled={picked.length === 0 || undefined} onClick={done}>
            {`Show ${picked.length} column${picked.length === 1 ? "" : "s"}`}
          </s-button>
        </s-stack>
      }
    >
      <s-stack gap="base">
        <TextBox label="Search columns" value={search} onChange={setSearch} placeholder="For example SEO, French, material" />
        {section("Product", candidates.filter((c) => c.group === "Product"))}
        {section("Variant fields", candidates.filter((c) => c.group === "Variant"), "Price and compare-at price of your primary market, SKU and barcode. Only for products with one variant.")}
        {slots.length > 0 ? section("Translations", candidates.filter((c) => c.group === "Translations"), "Type or paste the text. Nothing is translated for you.") : null}
        {section("Product metafields", candidates.filter((c) => c.group === "Metafields"), "Single values can be edited here. Lists and other types are shown only: edit them on Edit product.")}
      </s-stack>
    </Dialog>
  );
}
