// The input for one metafield value, matched to its type: text, number, yes/no, date, colour, link, JSON, unit values,
// lists (add, remove, reorder), choices from the definition, and references picked with Shopify's own picker.
// The value is checked as it is typed (mfModel.storedFromDrafts); problems show under the box.

import { choicesOf } from "../../lib/editor/mfModel";
import { isRefKind, newDraft } from "../../lib/editor/mfModel";
import type { Validation } from "../../lib/editor/mfRules";
import { inputKindOf, isListType, unitsFor, type Draft, type InputKind } from "../../lib/editor/mfTypes";
import { SelectField } from "../SelectField";
import { TextBox } from "./TextBox";

const HINT: Partial<Record<InputKind, string>> = {
  date: "Year-month-day, for example 2026-10-24",
  datetime: "For example 2026-10-24T09:00:00Z",
  color: "For example #A1B2C3",
  url: "Starts with https://",
  json: "Valid JSON",
  richtext: "Blank line between paragraphs. # heading, - bullet, **bold**, *italic*, [text](https://link)",
};

type ResourceKind = "product" | "variant" | "collection";
type Picked = { id: string; title?: string; displayName?: string };

async function pick(kind: ResourceKind, multiple: boolean, current: string[]): Promise<{ id: string; label: string }[] | null> {
  const result = (await shopify.resourcePicker({
    type: kind,
    multiple,
    action: "select",
    selectionIds: current.map((id) => ({ id })),
  } as never)) as unknown as Picked[] | undefined;
  if (!result) return null;
  return Array.from(result).map((p) => ({ id: p.id, label: p.title ?? p.displayName ?? p.id }));
}

function RefPicker({ type, draft, onChange, disabled, name }: { type: string; draft: Draft; onChange: (d: Draft) => void; disabled?: boolean; name: string }) {
  const kind = inputKindOf(type);
  const list = isListType(type);
  const resource: ResourceKind = kind === "ref-variant" ? "variant" : kind === "ref-collection" ? "collection" : "product";
  const word = resource === "variant" ? "variants" : resource === "collection" ? "collections" : "products";
  const move = (i: number, d: number) => {
    const refs = [...draft.refs];
    const j = i + d;
    if (j < 0 || j >= refs.length) return;
    [refs[i], refs[j]] = [refs[j]!, refs[i]!];
    onChange({ ...draft, refs });
  };
  return (
    <s-stack gap="small-200">
      {draft.refs.length === 0 ? <s-text color="subdued">{`No ${list ? word : resource} picked.`}</s-text> : null}
      {draft.refs.map((r, i) => (
        <s-stack key={r.id} direction="inline" gap="small-200" alignItems="center">
          <s-text>{r.label}</s-text>
          {list && !disabled ? (
            <>
              <s-button variant="tertiary" disabled={i === 0 || undefined} accessibilityLabel={`Move ${r.label} up`} onClick={() => move(i, -1)}>
                Up
              </s-button>
              <s-button variant="tertiary" disabled={i === draft.refs.length - 1 || undefined} accessibilityLabel={`Move ${r.label} down`} onClick={() => move(i, 1)}>
                Down
              </s-button>
            </>
          ) : null}
          {!disabled ? (
            <s-button variant="tertiary" tone="critical" accessibilityLabel={`Remove ${r.label}`} onClick={() => onChange({ ...draft, refs: draft.refs.filter((x) => x.id !== r.id) })}>
              Remove
            </s-button>
          ) : null}
        </s-stack>
      ))}
      {!disabled ? (
        <div>
          <s-button
            accessibilityLabel={`Pick ${word} for ${name}`}
            onClick={async () => {
              const picked = await pick(resource, list, draft.refs.map((r) => r.id));
              if (picked) onChange({ ...draft, refs: list ? picked : picked.slice(0, 1) });
            }}
          >
            {list ? `Pick ${word}` : draft.refs.length > 0 ? `Change ${resource}` : `Pick a ${resource}`}
          </s-button>
        </div>
      ) : null}
    </s-stack>
  );
}

function OneBox({ type, validations, draft, onChange, error, label, disabled }: { type: string; validations: Validation[]; draft: Draft; onChange: (d: Draft) => void; error: string | null; label: string; disabled?: boolean }) {
  const kind = inputKindOf(type);
  const choices = kind === "text" ? choicesOf(validations) : null;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  if (kind === "boolean") {
    return (
      <SelectField
        label={label}
        hideLabel
        value={draft.text}
        options={[
          { value: "", label: "No value" },
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]}
        onChange={(v) => set({ text: v })}
      />
    );
  }
  if (choices) {
    const options = [{ value: "", label: "No value" }, ...choices.map((c) => ({ value: c, label: c }))];
    if (draft.text && !choices.includes(draft.text)) options.push({ value: draft.text, label: `${draft.text} (not allowed)` });
    return <SelectField label={label} hideLabel value={draft.text} options={options} onChange={(v) => set({ text: v })} />;
  }
  if (kind === "dimension" || kind === "weight" || kind === "volume") {
    return (
      <s-stack direction="inline" gap="small-200" alignItems="start">
        <TextBox label={label} hideLabel value={draft.text} onChange={(text) => set({ text })} error={error} disabled={disabled} placeholder="Number" />
        <SelectField label="Unit" hideLabel value={draft.unit} options={unitsFor(kind).map((u) => ({ value: u, label: u }))} onChange={(unit) => set({ unit })} />
      </s-stack>
    );
  }
  if (kind === "money") {
    return (
      <s-stack direction="inline" gap="small-200" alignItems="start">
        <TextBox label={label} hideLabel value={draft.text} onChange={(text) => set({ text })} error={error} disabled={disabled} placeholder="Amount" />
        <TextBox label="Currency code" hideLabel value={draft.currency} onChange={(currency) => set({ currency })} placeholder="USD" />
      </s-stack>
    );
  }
  if (kind === "rating") {
    return <TextBox label={label} hideLabel value={draft.text} onChange={(text) => set({ text })} error={error} disabled={disabled} details={`Between ${draft.ratingMin} and ${draft.ratingMax}`} />;
  }
  const multi = kind === "multiline" || kind === "json" || kind === "richtext";
  return <TextBox label={label} hideLabel value={draft.text} onChange={(text) => set({ text })} error={error} disabled={disabled} multiline={multi} rows={kind === "multiline" || kind === "richtext" ? 5 : 4} details={HINT[kind]} />;
}

export function ValueEditor({
  type,
  validations,
  drafts,
  onChange,
  itemErrors,
  error,
  disabled,
  name,
}: {
  type: string;
  validations: Validation[];
  drafts: Draft[];
  onChange: (drafts: Draft[]) => void;
  itemErrors: (string | null)[];
  error: string | null;
  disabled?: boolean;
  name: string;
}) {
  const kind = inputKindOf(type);
  const list = isListType(type);

  if (isRefKind(kind)) {
    const draft = drafts[0] ?? newDraft(type, validations);
    return (
      <s-stack gap="small-200">
        <RefPicker type={type} draft={draft} onChange={(d) => onChange([d])} disabled={disabled} name={name} />
        {error ? <s-text tone="critical">{error}</s-text> : null}
      </s-stack>
    );
  }

  if (!list) {
    const draft = drafts[0] ?? newDraft(type, validations);
    return <OneBox type={type} validations={validations} draft={draft} onChange={(d) => onChange([d])} error={error ?? itemErrors[0] ?? null} label={name} disabled={disabled} />;
  }

  const move = (i: number, d: number) => {
    const next = [...drafts];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  return (
    <s-stack gap="small-200">
      {drafts.length === 0 ? <s-text color="subdued">The list is empty.</s-text> : null}
      {drafts.map((d, i) => (
        <s-stack key={i} direction="inline" gap="small-200" alignItems="start">
          <div style={{ flex: 1, minWidth: 0 }}>
            <OneBox type={type} validations={validations} draft={d} onChange={(next) => onChange(drafts.map((x, j) => (j === i ? next : x)))} error={itemErrors[i] ?? null} label={`${name}, item ${i + 1}`} disabled={disabled} />
          </div>
          {!disabled ? (
            <s-stack direction="inline" gap="small-100">
              <s-button variant="tertiary" disabled={i === 0 || undefined} accessibilityLabel={`Move item ${i + 1} up`} onClick={() => move(i, -1)}>
                Up
              </s-button>
              <s-button variant="tertiary" disabled={i === drafts.length - 1 || undefined} accessibilityLabel={`Move item ${i + 1} down`} onClick={() => move(i, 1)}>
                Down
              </s-button>
              <s-button variant="tertiary" tone="critical" accessibilityLabel={`Remove item ${i + 1}`} onClick={() => onChange(drafts.filter((_, j) => j !== i))}>
                Remove
              </s-button>
            </s-stack>
          ) : null}
        </s-stack>
      ))}
      {!disabled ? (
        <div>
          <s-button onClick={() => onChange([...drafts, newDraft(type, validations)])}>Add an item</s-button>
        </div>
      ) : null}
      {error && !itemErrors.some(Boolean) ? <s-text tone="critical">{error}</s-text> : null}
    </s-stack>
  );
}
