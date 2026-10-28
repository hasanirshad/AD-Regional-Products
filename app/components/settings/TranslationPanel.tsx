import { useState } from "react";
import { CORE_FIELDS, CORE_FIELD_LABEL, rowId, rowLabel, type TranslationRow } from "../../../extensions/shared/settings";
import { onChecked } from "../../lib/dom";
import { translatableMetafield } from "../../lib/editor/mfModel";
import { SelectField } from "../SelectField";
import { edited, errorAt, errorsUnder, ErrorLine, ListRow, moved, nameOf, type PanelProps } from "./widgets";

/** Translation status: the languages, and which rows the block shows, in which order. */
export function TranslationPanel({ draft, set, problems, productDefs, info }: PanelProps) {
  const [counter, setCounter] = useState(0);
  const rows = draft.translation.rows;
  const locales = (info?.locales ?? []).filter((l) => !l.primary);
  const known = new Set(draft.languages.map((l) => l.code));
  const stale = draft.languages.filter((l) => !locales.some((x) => x.locale === l.code));
  const used = new Set(rows.map(rowId));
  const defs = productDefs.data;

  const toggleLanguage = (code: string, name: string, on: boolean) =>
    set(
      edited(draft, (d) => {
        const next = on ? [...d.languages, { code, label: name }] : d.languages.filter((l) => l.code !== code);
        // Keep the store's own order, then any language the store no longer has.
        d.languages = [...locales.filter((l) => next.some((n) => n.code === l.locale)).map((l) => next.find((n) => n.code === l.locale)!), ...next.filter((n) => !locales.some((l) => l.locale === n.code))];
      }),
    );

  const add = (value: string) => {
    let row: TranslationRow | null = null;
    if (value.startsWith("core:")) row = { type: "core", field: value.slice(5) as (typeof CORE_FIELDS)[number] };
    else if (value === "optionNames") row = { type: "optionNames" };
    else if (value === "optionValues") row = { type: "optionValues" };
    else if (value.startsWith("ns:")) row = { type: "namespace", namespace: value.slice(3) };
    else if (value.startsWith("mf:")) {
      const full = value.slice(3);
      const dot = full.indexOf(".");
      row = { type: "metafield", namespace: full.slice(0, dot), key: full.slice(dot + 1) };
    }
    if (!row) return;
    const added = row;
    set(edited(draft, (d) => void d.translation.rows.push(added)));
    setCounter((n) => n + 1);
  };

  const namespaces = [...new Set((defs ?? []).map((d) => d.namespace))].filter((n) => !rows.some((r) => r.type === "namespace" && r.namespace === n));
  const options = [
    { value: "", label: "Add a row…" },
    ...CORE_FIELDS.filter((f) => !used.has(`core:${f}`)).map((f) => ({ value: `core:${f}`, label: `Field: ${CORE_FIELD_LABEL[f]}` })),
    ...(used.has("optionNames") ? [] : [{ value: "optionNames", label: "Option names" }]),
    ...(used.has("optionValues") ? [] : [{ value: "optionValues", label: "Option values" }]),
    ...namespaces.map((n) => ({ value: `ns:${n}`, label: `All product metafields in "${n}"` })),
    ...(defs ?? [])
      .filter((d) => translatableMetafield(d.type) && !used.has(`mf:${d.namespace}.${d.key}`))
      .map((d) => ({ value: `mf:${d.namespace}.${d.key}`, label: `Metafield: ${d.namespace}.${d.key} (${d.name})` })),
  ];

  return (
    <s-stack gap="large-100">
      <s-stack gap="small-200">
        <s-heading>Languages</s-heading>
        <s-text color="subdued">The block, and the Sale and badge block, check these languages.</s-text>
        {info === null ? <s-text color="subdued">Reading your store's languages…</s-text> : null}
        {info !== null && locales.length === 0 ? <s-text color="subdued">Your store has no language besides the main one.</s-text> : null}
        {locales.map((l) => (
          <s-checkbox key={l.locale} label={`${l.name} (${l.locale})${l.published ? "" : " · not published"}`} checked={known.has(l.locale) || undefined} ref={onChecked((on) => toggleLanguage(l.locale, l.name, on))} />
        ))}
        {stale.map((l) => (
          <s-checkbox key={l.code} label={`${l.label} (${l.code}) · not a language of this store`} checked ref={onChecked((on) => toggleLanguage(l.code, l.label, on))} />
        ))}
        <ErrorLine message={errorAt(problems, "languages") ?? errorsUnder(problems, "languages")[0]?.message} />
      </s-stack>

      <s-stack gap="small-200">
        <s-heading>Rows</s-heading>
        <s-text color="subdued">One row for each field the block checks. Core fields, product metafields, and option names and values.</s-text>
        {rows.length === 0 ? <s-text color="subdued">No rows. The block would show nothing. Add a row below.</s-text> : null}
        {rows.map((r, i) => {
          const id = rowId(r);
          const name = r.type === "metafield" ? nameOf(defs, r.namespace, r.key) : undefined;
          return (
            <ListRow
              key={id}
              title={rowLabel(r)}
              detail={name}
              badge={r.type === "core" ? "Field" : r.type === "metafield" || r.type === "namespace" ? "Metafield" : "Options"}
              index={i}
              count={rows.length}
              onMove={(delta) => set(edited(draft, (d) => void (d.translation.rows = moved(d.translation.rows, i, delta))))}
              onRemove={() => set(edited(draft, (d) => void d.translation.rows.splice(i, 1)))}
              error={errorAt(problems, `translation.rows.${i}`)}
            />
          );
        })}
        <ErrorLine message={errorAt(problems, "translation.rows")} />
        {productDefs.status === "loading" || productDefs.status === "idle" ? <s-text color="subdued">Reading your metafield definitions…</s-text> : null}
        {productDefs.status === "error" ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text tone="critical">{`Metafield definitions could not be read: ${productDefs.error}`}</s-text>
            <s-button onClick={productDefs.reload}>Try again</s-button>
          </s-stack>
        ) : null}
        <SelectField key={counter} label="Add a row" value="" options={options} onChange={add} />
      </s-stack>
    </s-stack>
  );
}
