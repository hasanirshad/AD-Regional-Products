import { useState, type ReactNode } from "react";
import { STATUS_TONE, STATUS_WORDS, type TranslationStatus } from "../../lib/editor/canon";
import type { Slot } from "../../lib/editor/locales";
import { TextBox } from "./TextBox";

export type LangCell = {
  slot: Slot;
  /** What the box shows: the pending translation, or the saved one. */
  value: string;
  status: TranslationStatus;
  /** Edited and not saved. */
  changed: boolean;
  editable: boolean;
  /** Why the box cannot be edited. */
  note?: string;
  onChange: (text: string) => void;
};

/**
 * One field on screen: the source value and one box per store language, side by side, each with its status.
 * The "copy the source into the empty languages" button only fills boxes; a person confirms it first and then still
 * reviews and saves like any other edit. Nothing is translated by the app.
 */
export function FieldBlock({
  label,
  hint,
  source,
  sourceText,
  primaryName,
  cells,
  multiline,
  rows,
  changed,
}: {
  label: string;
  hint?: string;
  /** The editor for the source value. */
  source: ReactNode;
  /** The source value as plain text, for the copy button. */
  sourceText: string;
  primaryName: string;
  cells: LangCell[];
  multiline?: boolean;
  rows?: number;
  /** The source value was edited and not saved. */
  changed?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const empty = cells.filter((c) => c.editable && c.value.trim() === "");
  const canCopy = sourceText.trim() !== "" && empty.length > 0;

  return (
    <s-section heading={label}>
      <s-stack gap="base">
        {hint ? <s-text color="subdued">{hint}</s-text> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16, alignItems: "start" }}>
          <div style={{ minWidth: 0 }}>
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">{primaryName}</s-text>
                <s-badge>Source</s-badge>
                {changed ? <s-badge tone="info">Edited</s-badge> : null}
              </s-stack>
              {source}
            </s-stack>
          </div>
          {cells.map((c) => (
            <div key={c.slot.key} style={{ minWidth: 0 }}>
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text type="strong">{c.slot.label}</s-text>
                  <s-badge tone={STATUS_TONE[c.status]}>{STATUS_WORDS[c.status]}</s-badge>
                  {c.changed ? <s-badge tone="info">Edited</s-badge> : null}
                </s-stack>
                <TextBox
                  label={`${label} in ${c.slot.label}`}
                  hideLabel
                  value={c.value}
                  onChange={c.onChange}
                  multiline={multiline}
                  rows={rows}
                  disabled={!c.editable}
                  placeholder={c.editable ? "Type or paste the translation" : undefined}
                  details={c.note}
                />
              </s-stack>
            </div>
          ))}
        </div>
        {canCopy ? (
          asking ? (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text>{`Put the source text into ${empty.length} empty ${empty.length === 1 ? "language" : "languages"} (${empty.map((c) => c.slot.label).join(", ")})? You still review before anything is saved.`}</s-text>
              <s-button
                variant="primary"
                onClick={() => {
                  for (const c of empty) c.onChange(sourceText);
                  setAsking(false);
                }}
              >
                Yes, copy
              </s-button>
              <s-button onClick={() => setAsking(false)}>Cancel</s-button>
            </s-stack>
          ) : (
            <div>
              <s-button variant="tertiary" onClick={() => setAsking(true)}>
                Copy the source into empty languages
              </s-button>
            </div>
          )
        ) : null}
      </s-stack>
    </s-section>
  );
}
