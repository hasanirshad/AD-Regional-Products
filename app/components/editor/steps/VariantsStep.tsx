// Step 2, Variants: up to three options (Size, Colour…), their values, the names in every language, and the order they
// show in on the product page. Options and values are dragged (or moved with the arrows) like in the Shopify admin.
// Saving is its own reviewed run (optionsEngine): the options are created first, then their translations, in sequence.
// Removing an option or a value is not offered (it deletes variants): that stays in the Shopify admin.

import { useMemo, useState } from "react";
import type { ProductDoc } from "../../../lib/editor/doc";
import { liveGql } from "../../../lib/editor/gql";
import {
  MAX_OPTIONS,
  cleanName,
  hasOnlyDefaultOption,
  moveItem,
  optionProblems,
  optionsEngine,
  parseValues,
  planIsEmpty,
  planOptions,
  variantCountOf,
  variantNames,
  type OptionDraft,
  type OptionPlan,
  type ValueDraft,
} from "../../../lib/editor/optionsPlan";
import type { EditState } from "../../../views/edit-state";
import type { EditorShared } from "../../../views/editor-state";
import { Loading } from "../../Loading";
import { RunFlow } from "../../RunFlow";
import { TextBox } from "../TextBox";
import { StepHeading } from "./StepStrip";

/** What the options on screen mean for Shopify: the plan, the problems and the number of things waiting. Used by the page's footer and strip too. */
export function optionsStatus(edit: EditState): { plan: OptionPlan | null; problems: string[]; waiting: number } {
  const base = edit.options.base;
  if (!base) return { plan: null, problems: [], waiting: 0 };
  const plan = planOptions(base, edit.options.draft);
  const problems = planIsEmpty(plan) ? [] : optionProblems(edit.options.draft, base);
  return { plan, problems, waiting: planIsEmpty(plan) ? 0 : Math.max(1, plan.lines.length) };
}

type Drag = { kind: "option"; oi: number } | { kind: "value"; oi: number; vi: number } | null;

const HANDLE: React.CSSProperties = { cursor: "grab", userSelect: "none", fontSize: 18, lineHeight: 1, padding: "4px 6px", color: "var(--p-color-text-secondary, #616161)" };
const CARD: React.CSSProperties = { border: "1px solid var(--p-color-border, #d0d0d0)", borderRadius: 12, padding: 12, background: "var(--p-color-bg-surface, #fff)" };

export function VariantsStep({
  edit,
  shared,
  doc,
  running,
  setRunning,
  onSaved,
}: {
  edit: EditState;
  shared: EditorShared;
  doc: ProductDoc;
  running: boolean;
  setRunning: (on: boolean) => void;
  /** After a saved run, when the person leaves the run screen. */
  onSaved: () => void;
}) {
  const { base, draft, setDraft, error } = edit.options;
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const slots = shared.slots;

  const status = optionsStatus(edit);
  const plan = status.plan;
  const problems = status.problems;
  const defaultOnly = hasOnlyDefaultOption(doc.options);

  // Edits on the default variant belong to a variant that is replaced when the options are created.
  const oldVariantEdits = useMemo(() => {
    if (!plan?.createAll) return [] as string[];
    const ids = doc.variants.map((v) => v.id);
    return Object.keys(edit.edits).filter((k) => ids.some((id) => k.startsWith(`v|${id}|`) || k.startsWith(`s|${id}|`) || k.startsWith(`m|${id}|`)));
  }, [plan?.createAll, doc.variants, edit.edits]);

  const engine = useMemo(
    () => (running && base ? optionsEngine(liveGql, { productId: doc.id, title: doc.title, handle: doc.handle, saved: base, draft: structuredClone(draft), plan: planOptions(base, draft) }, () => undefined) : null),
    [running], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (error && !base) {
    return (
      <s-stack gap="base">
        <StepHeading step="variants" />
        <s-banner tone="critical" heading="Could not read the options">
          <s-paragraph>{error}</s-paragraph>
          <s-button slot="secondary-actions" onClick={() => void edit.options.reload()}>
            Try again
          </s-button>
        </s-banner>
      </s-stack>
    );
  }
  if (!base) return <Loading message="Reading the options…" />;

  if (running && engine && plan) {
    return (
      <RunFlow
        engine={engine}
        action="Variants"
        applyLabel={plan.createAll ? `Create ${plan.variantsAfter} variant${plan.variantsAfter === 1 ? "" : "s"}` : "Save the variants"}
        blocker={problems[0] ?? null}
        onBack={() => setRunning(false)}
        onFinished={() => {
          if (oldVariantEdits.length) edit.discard(oldVariantEdits);
          void (async () => {
            await edit.refresh([doc.id]);
            await edit.options.reload();
            setRunning(false);
            onSaved();
          })();
        }}
        finishLabel="Back to the variants step"
      >
        <s-section heading="Review">
          <s-stack gap="small-200">
            <s-text>{`Shopify will make these changes to ${doc.title}:`}</s-text>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {plan.lines.map((l, i) => (
                <li key={i}>
                  <s-text>{l}</s-text>
                </li>
              ))}
            </ul>
            {plan.createAll ? <s-text color="subdued">Each new variant starts with the price of the first one. You set prices and stock on the next step.</s-text> : null}
            {oldVariantEdits.length > 0 ? <s-banner tone="warning">{`${oldVariantEdits.length} unsaved edit${oldVariantEdits.length === 1 ? "" : "s"} on the default variant (price, SKU or stock) will be dropped, because the default variant is replaced. Enter them again on the next step.`}</s-banner> : null}
          </s-stack>
        </s-section>
      </RunFlow>
    );
  }

  const setOption = (oi: number, next: OptionDraft) => setDraft(draft.map((o, i) => (i === oi ? next : o)));
  const setValue = (oi: number, vi: number, next: ValueDraft) => setOption(oi, { ...draft[oi]!, values: draft[oi]!.values.map((v, i) => (i === vi ? next : v)) });
  const addOption = () => setDraft([...draft, { name: "", tr: {}, values: [] }]);
  const addValues = (oi: number, text: string) => {
    const o = draft[oi]!;
    const found = parseValues(text, o.values.map((v) => v.name));
    if (found.length === 0) return;
    setOption(oi, { ...o, values: [...o.values, ...found.map((name) => ({ name, tr: {} }))] });
    setTyped((t) => ({ ...t, [oi]: "" }));
  };
  const savedOption = (o: OptionDraft) => (o.id ? base.find((b) => b.id === o.id) : undefined);

  const names = variantNames(draft);

  // ---- drag and drop (same list only)
  const dropOn = (target: Drag) => {
    if (!drag || !target) return;
    if (drag.kind === "option" && target.kind === "option") setDraft(moveItem(draft, drag.oi, target.oi));
    else if (drag.kind === "value" && target.kind === "value" && drag.oi === target.oi) setOption(drag.oi, { ...draft[drag.oi]!, values: moveItem(draft[drag.oi]!.values, drag.vi, target.vi) });
    setDrag(null);
    setOver(null);
  };
  const dropProps = (target: Drag, id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (drag && target && drag.kind === target.kind && (drag.kind === "option" || (target.kind === "value" && drag.kind === "value" && drag.oi === target.oi))) {
        e.preventDefault();
        setOver(id);
      }
    },
    onDragLeave: () => setOver((cur) => (cur === id ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dropOn(target);
    },
  });
  const dragProps = (d: Drag) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "move");
      setDrag(d);
    },
    onDragEnd: () => {
      setDrag(null);
      setOver(null);
    },
  });

  return (
    <s-stack gap="base">
      <StepHeading step="variants" />
      {defaultOnly && draft.length === 0 ? (
        <s-banner tone="info" heading="One variant for now">
          <s-paragraph>A product with no options has a single variant. If it comes in sizes, colours or materials, add the options below. Skip this step if it does not.</s-paragraph>
        </s-banner>
      ) : null}
      {!defaultOnly ? (
        <s-banner tone="info">
          <s-paragraph>You can rename, add values and change the order here. Removing an option or a value deletes variants, so that is done in the Shopify admin.</s-paragraph>
        </s-banner>
      ) : null}

      {draft.map((o, oi) => {
        const saved = savedOption(o);
        const id = `o${oi}`;
        return (
          <div key={oi} {...dropProps({ kind: "option", oi }, id)} style={{ ...CARD, outline: over === id ? "2px dashed var(--p-color-border-emphasis, #303030)" : "none", opacity: drag?.kind === "option" && drag.oi === oi ? 0.5 : 1 }}>
            <s-stack gap="base">
              <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <span {...dragProps({ kind: "option", oi })} title="Drag to change the order of the options" aria-hidden="true" style={HANDLE}>
                    ⠿
                  </span>
                  <s-heading>{`Option ${oi + 1}${cleanName(o.name) ? ` · ${cleanName(o.name)}` : ""}`}</s-heading>
                </s-stack>
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-button variant="tertiary" disabled={oi === 0 || undefined} accessibilityLabel={`Move option ${oi + 1} up`} onClick={() => setDraft(moveItem(draft, oi, oi - 1))}>
                    ↑
                  </s-button>
                  <s-button variant="tertiary" disabled={oi === draft.length - 1 || undefined} accessibilityLabel={`Move option ${oi + 1} down`} onClick={() => setDraft(moveItem(draft, oi, oi + 1))}>
                    ↓
                  </s-button>
                  {!saved ? (
                    <s-button variant="tertiary" tone="critical" onClick={() => setDraft(draft.filter((_, i) => i !== oi))}>
                      Remove
                    </s-button>
                  ) : null}
                </s-stack>
              </s-stack>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, alignItems: "start" }}>
                <TextBox label="Option name" value={o.name} placeholder="Size" onChange={(name) => setOption(oi, { ...o, name })} />
                {slots.map((s) => (
                  <TextBox key={s.key} label={`Option name · ${s.label}`} value={o.tr[s.key] ?? ""} placeholder={cleanName(o.name) ? `${s.label} for "${cleanName(o.name)}"` : s.label} onChange={(text) => setOption(oi, { ...o, tr: { ...o.tr, [s.key]: text } })} />
                ))}
              </div>

              <s-stack gap="small-200">
                <s-text type="strong">Values</s-text>
                {o.values.length === 0 ? <s-text color="subdued">No values yet. Add them below.</s-text> : null}
                {o.values.map((v, vi) => {
                  const vid = `o${oi}v${vi}`;
                  const savedValue = v.id && saved ? saved.values.find((x) => x.id === v.id) : undefined;
                  return (
                    <div key={vi} {...dropProps({ kind: "value", oi, vi }, vid)} style={{ border: "1px solid var(--p-color-border-secondary, #e3e3e3)", borderRadius: 8, padding: 8, outline: over === vid ? "2px dashed var(--p-color-border-emphasis, #303030)" : "none", opacity: drag?.kind === "value" && drag.oi === oi && drag.vi === vi ? 0.5 : 1 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <span {...dragProps({ kind: "value", oi, vi })} title="Drag to change the order of the values" aria-hidden="true" style={{ ...HANDLE, paddingTop: 22 }}>
                          ⠿
                        </span>
                        <div style={{ flex: "1 1 160px", minWidth: 140 }}>
                          <TextBox label={`Value ${vi + 1}`} value={v.name} onChange={(name) => setValue(oi, vi, { ...v, name })} />
                        </div>
                        {slots.map((s) => (
                          <div key={s.key} style={{ flex: "1 1 160px", minWidth: 140 }}>
                            <TextBox label={s.label} value={v.tr[s.key] ?? ""} onChange={(text) => setValue(oi, vi, { ...v, tr: { ...v.tr, [s.key]: text } })} />
                          </div>
                        ))}
                        <div style={{ paddingTop: 20, display: "flex", gap: 2 }}>
                          <s-button variant="tertiary" disabled={vi === 0 || undefined} accessibilityLabel={`Move value ${vi + 1} of option ${oi + 1} up`} onClick={() => setOption(oi, { ...o, values: moveItem(o.values, vi, vi - 1) })}>
                            ↑
                          </s-button>
                          <s-button variant="tertiary" disabled={vi === o.values.length - 1 || undefined} accessibilityLabel={`Move value ${vi + 1} of option ${oi + 1} down`} onClick={() => setOption(oi, { ...o, values: moveItem(o.values, vi, vi + 1) })}>
                            ↓
                          </s-button>
                          {!savedValue ? (
                            <s-button variant="tertiary" tone="critical" accessibilityLabel={`Remove value ${vi + 1} of option ${oi + 1}`} onClick={() => setOption(oi, { ...o, values: o.values.filter((_, i) => i !== vi) })}>
                              Remove
                            </s-button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <s-stack direction="inline" gap="small-200" alignItems="end">
                  <div style={{ flex: "1 1 260px" }}>
                    <TextBox label="Add values" value={typed[oi] ?? ""} placeholder="180 cm, 200 cm, 220 cm" details="Separate several values with commas." onChange={(text) => setTyped((t) => ({ ...t, [oi]: text }))} />
                  </div>
                  <s-button onClick={() => addValues(oi, typed[oi] ?? "")} disabled={cleanName(typed[oi] ?? "") === "" || undefined}>
                    Add
                  </s-button>
                </s-stack>
              </s-stack>
            </s-stack>
          </div>
        );
      })}

      <div>
        <s-button disabled={draft.length >= MAX_OPTIONS || undefined} onClick={addOption}>
          {draft.length >= MAX_OPTIONS ? `Up to ${MAX_OPTIONS} options (Shopify's limit)` : draft.length === 0 ? "Add the first option" : "Add another option"}
        </s-button>
      </div>

      {draft.length > 0 ? (
        <s-section heading="What this makes">
          <s-stack gap="small-200">
            <s-text>{`${variantCountOf(draft)} variant${variantCountOf(draft) === 1 ? "" : "s"}, in this order on the product page:`}</s-text>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {names.slice(0, 24).map((n) => (
                <s-badge key={n}>{n}</s-badge>
              ))}
              {names.length > 24 ? <s-text color="subdued">{`and ${names.length - 24} more`}</s-text> : null}
            </div>
            {problems.length > 0 ? (
              <s-stack gap="small-100">
                {problems.map((p, i) => (
                  <s-text key={i} tone="critical">
                    {p}
                  </s-text>
                ))}
              </s-stack>
            ) : plan && !planIsEmpty(plan) ? (
              <s-stack gap="small-200">
                <s-text color="subdued">Waiting to be saved:</s-text>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {plan.lines.map((l, i) => (
                    <li key={i}>
                      <s-text>{l}</s-text>
                    </li>
                  ))}
                </ul>
                <div>
                  <s-button variant="primary" onClick={() => setRunning(true)}>
                    Review and save the variants
                  </s-button>
                </div>
              </s-stack>
            ) : (
              <s-text color="subdued">Nothing to save here.</s-text>
            )}
          </s-stack>
        </s-section>
      ) : null}
    </s-stack>
  );
}
