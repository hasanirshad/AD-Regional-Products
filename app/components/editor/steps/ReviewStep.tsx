// The last step: one tab per language. Each tab shows the main language on the left and that language on the right, for
// every text of the product, so a missing or outdated translation is seen before anything is saved. Metafields of type
// image or file are never listed (they are not translated). "Review changes and save" opens the shared review.

import { useMemo, useState } from "react";
import { STATUS_TONE, STATUS_WORDS, normText } from "../../../lib/editor/canon";
import { mfKey, type ProductDoc } from "../../../lib/editor/doc";
import { stepOfMetafield } from "../../../lib/editor/curated";
import { primaryLocale } from "../../../lib/editor/locales";
import { reviewCounts, reviewRows, type ReviewRow } from "../../../lib/editor/reviewRows";
import { stepInfo } from "../../../lib/editor/productSteps";
import type { EditState } from "../../../views/edit-state";
import type { EditorShared } from "../../../views/editor-state";
import { optionsStatus } from "./VariantsStep";
import { StepHeading } from "./StepStrip";

const plain = (html: string): string =>
  html
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function Cell({ value, html }: { value: string | null; html: boolean }) {
  const text = value === null ? "" : html ? plain(value) : normText(value);
  if (text === "") return <s-text color="subdued">—</s-text>;
  return (
    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      <s-text>{text.length > 600 ? `${text.slice(0, 600)}…` : text}</s-text>
    </div>
  );
}

export function ReviewStep({ edit, shared, doc }: { edit: EditState; shared: EditorShared; doc: ProductDoc }) {
  const slots = shared.slots;
  const [slotKey, setSlotKey] = useState<string>("");
  const active = slots.find((s) => s.key === slotKey) ?? slots[0];
  const primary = primaryLocale(shared.info.data?.locales ?? [])?.name ?? "Primary language";

  const metafields = useMemo(() => {
    const defs = shared.productDefs.data ?? [];
    return defs
      .filter((d) => d.ownerKind === "PRODUCT")
      .filter((d) => (doc.metafields[mfKey(d.namespace, d.key)]?.value ?? "") !== "" || `m|${doc.id}|${d.namespace}.${d.key}` in edit.edits)
      .map((d) => ({ namespace: d.namespace, key: d.key, name: d.name, type: d.type, step: stepOfMetafield({ namespace: d.namespace, key: d.key, name: d.name, type: d.type, ownerKind: d.ownerKind }) }))
      .filter((m) => m.step === "content" || m.step === "productOptions");
  }, [shared.productDefs.data, doc, edit.edits]);

  const rowsFor = (slot: string): ReviewRow[] => reviewRows({ doc, effectiveOf: edit.effectiveValue, options: edit.options.draft, metafields }, slot);
  const tabs = useMemo(() => slots.map((s) => ({ slot: s, counts: reviewCounts(rowsFor(s.key)) })), [slots, doc, edit.edits, edit.options.draft, metafields]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (active ? rowsFor(active.key) : []), [active?.key, doc, edit.edits, edit.options.draft, metafields]); // eslint-disable-line react-hooks/exhaustive-deps

  const opt = optionsStatus(edit);
  const blockers = edit.built.errors;
  const waiting = edit.built.changes.filter((c) => c.productId === doc.id).length;

  // Rows in sections, in the order they were made.
  const sections: { name: string; rows: ReviewRow[] }[] = [];
  for (const r of rows) {
    const last = sections[sections.length - 1];
    if (last && last.name === r.section) last.rows.push(r);
    else sections.push({ name: r.section, rows: [r] });
  }

  return (
    <s-stack gap="base">
      <StepHeading step="review" />

      {opt.waiting > 0 ? (
        <s-banner tone="warning" heading="The options are not saved yet">
          <s-paragraph>The options and their translations are saved on the Variants step. Save them there first, so they are in the product.</s-paragraph>
          <s-button slot="secondary-actions" onClick={() => edit.go("variants")}>
            Go to Variants
          </s-button>
        </s-banner>
      ) : null}

      {slots.length === 0 ? (
        <s-section>
          <s-text color="subdued">This store has no other language yet, so there is nothing to compare. Add a language in Shopify to see it here.</s-text>
        </s-section>
      ) : (
        <s-section heading="Languages">
          <s-stack gap="base">
            <nav aria-label="Languages" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {tabs.map(({ slot, counts }) => {
                const here = slot.key === active?.key;
                const todo = counts.missing + counts.outdated;
                return (
                  <button
                    key={slot.key}
                    type="button"
                    aria-current={here ? "true" : undefined}
                    onClick={() => setSlotKey(slot.key)}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: `1px solid ${here ? "var(--p-color-border-emphasis, #303030)" : "var(--p-color-border, #d0d0d0)"}`,
                      background: here ? "var(--p-color-bg-surface-selected, #f1f1f1)" : "var(--p-color-bg-surface, #fff)",
                      color: "var(--p-color-text, #303030)",
                      font: "inherit",
                      fontWeight: here ? 650 : 450,
                      cursor: "pointer",
                    }}
                  >
                    <span>{slot.label}</span>
                    <span style={{ fontSize: 12, borderRadius: 999, padding: "0 8px", background: todo > 0 ? "var(--p-color-bg-fill-critical, #c70a24)" : "var(--p-color-bg-fill-success, #29845a)", color: "#fff" }}>{todo > 0 ? `${todo} to do` : "complete"}</span>
                  </button>
                );
              })}
            </nav>
            {active ? (
              <s-text color="subdued">{`${primary} on the left, ${active.label} on the right. Each row has a button that opens the step where it is edited.`}</s-text>
            ) : null}
          </s-stack>
        </s-section>
      )}

      {active
        ? sections.map((sec) => (
            <s-section key={sec.name} heading={sec.name}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 0.6fr) minmax(0, 1fr) minmax(0, 1fr) auto", gap: "10px 16px", alignItems: "start" }}>
                <s-text type="strong">Field</s-text>
                <s-text type="strong">{primary}</s-text>
                <s-text type="strong">{active.label}</s-text>
                <span />
                {sec.rows.map((r) => (
                  <RowCells key={r.key} row={r} onEdit={() => edit.go(r.step)} stepName={stepInfo(r.step).label} />
                ))}
              </div>
            </s-section>
          ))
        : null}

      <s-section heading="Save">
        <s-stack gap="small-200">
          {blockers.length > 0 ? (
            <s-stack gap="small-100">
              <s-text tone="critical">{blockers.length === 1 ? "One field needs fixing before you can review:" : `${blockers.length} fields need fixing before you can review:`}</s-text>
              {blockers.slice(0, 5).map((b, i) => (
                <s-text key={i} tone="critical">
                  {b.message}
                </s-text>
              ))}
            </s-stack>
          ) : null}
          <s-text>{waiting === 0 ? "No unsaved changes for this product." : `${waiting} unsaved change${waiting === 1 ? "" : "s"} for this product.`}</s-text>
          <div>
            <s-button variant="primary" disabled={waiting === 0 || blockers.length > 0 || undefined} onClick={() => edit.setMode("review")}>
              Review changes and save
            </s-button>
          </div>
          <s-text color="subdued">The product is saved as a draft. Open it in Shopify or use the preview link at the top to check it, then make it active there.</s-text>
        </s-stack>
      </s-section>
    </s-stack>
  );
}

function RowCells({ row, onEdit, stepName }: { row: ReviewRow; onEdit: () => void; stepName: string }) {
  const translated = row.status !== "not-translated";
  return (
    <>
      <div>
        <s-text>{row.label}</s-text>
      </div>
      <Cell value={row.primary} html={row.html} />
      <div>
        {translated ? (
          <s-stack gap="small-100">
            <Cell value={row.translation} html={row.html} />
            {row.status !== "not-translated" && row.status !== "no-source" ? <s-badge tone={STATUS_TONE[row.status]}>{STATUS_WORDS[row.status]}</s-badge> : null}
          </s-stack>
        ) : (
          <s-text color="subdued">Not translated</s-text>
        )}
      </div>
      <s-button variant="tertiary" accessibilityLabel={`Edit ${row.label} in ${stepName}`} onClick={onEdit}>
        Edit
      </s-button>
    </>
  );
}
