// The metafield steps: Variant details (sub-tabs Sizes & dimensions / Swatches & visibility), Product options (sub-tabs
// Options & customisation / Related & recommended), Content, Lead times and Images & files. The store's metafield
// definitions are placed on the screen they belong to by name (curated.ts); what no group claims is reachable through
// "Add another metafield", and anything that already holds a value is shown, so nothing filled in is overlooked.
// Each value gets an input matched to its type (ValueEditor), with translations beside it where the type is text.

import { useEffect, useMemo, useState } from "react";
import { onChecked } from "../../../lib/dom";
import { mfKey, variantTitle, type ProductDoc } from "../../../lib/editor/doc";
import { chooserDefinitions, fold, leftovers, placeDefinitions, splitLeftovers, subOfMetafield } from "../../../lib/editor/curated";
import { defKey, type Definition } from "../../../lib/editor/load";
import { draftsFromStored, storedFromDrafts } from "../../../lib/editor/mfModel";
import type { Target } from "../../../lib/editor/model";
import { firstSub, stepInfo, type StepId } from "../../../lib/editor/productSteps";
import type { EditState } from "../../../views/edit-state";
import type { EditorShared } from "../../../views/editor-state";
import { Loading } from "../../Loading";
import { MetafieldChooser, MetafieldRow } from "../MetafieldsTab";
import { StepHeading, SubTabs } from "./StepStrip";
import { stockKindOf } from "./StockKindToggle";

export type CuratedStepId = "variantOptions" | "productOptions" | "content" | "leadTimes" | "files";

/** Screens that do not translate their values. */
const NO_TRANSLATIONS: StepId[] = ["variantOptions", "leadTimes", "files"];

const metafieldTarget = (doc: ProductDoc, def: Definition, ownerId: string): Target => ({ kind: "metafield", productId: doc.id, ownerId, ownerKind: def.ownerKind, namespace: def.namespace, key: def.key, type: def.type });

const hasProductValue = (doc: ProductDoc, d: Definition): boolean => (doc.metafields[mfKey(d.namespace, d.key)]?.value ?? "") !== "";

/** "Stock delivery" is for products kept in stock: hidden on a made to order product unless it already has a value or the person asks. */
const isStockDelivery = (d: Definition): boolean => {
  const t = fold(`${d.name} ${d.key}`);
  return /\bstock\b/.test(t) && /\bdeliver/.test(t);
};

export function CuratedStep({ edit, shared, doc, step }: { edit: EditState; shared: EditorShared; doc: ProductDoc; step: CuratedStepId }) {
  const variantScope = step === "variantOptions";
  const defsLazy = variantScope ? shared.variantDefs : shared.productDefs;
  const defs = useMemo(() => defsLazy.data ?? [], [defsLazy.data]);
  const info = stepInfo(step);
  const sub = info.subtabs ? (edit.sub ?? firstSub(step)) : null;
  const kind = stockKindOf(edit, doc);
  const [choosing, setChoosing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const noTr = NO_TRANSLATIONS.includes(step);
  const chosenKind = variantScope ? "variant" : "product";
  const chosen = edit.chosen[chosenKind];

  const placedAll = useMemo(() => placeDefinitions(defs, step, null, kind), [defs, step, kind]);
  const placed = useMemo(() => placeDefinitions(defs, step, sub, kind), [defs, step, sub, kind]);
  const showLeftovers = !info.subtabs || sub === info.subtabs[0]!.id;

  // Variant metafields are read only for the keys wanted: every key this step places, plus the ones the person added.
  const placedKeys = useMemo(() => placedAll.flatMap((p) => p.defs.map(defKey)), [placedAll]);
  useEffect(() => {
    if (!variantScope || placedKeys.length === 0) return;
    const missing = placedKeys.filter((k) => !chosen.includes(k));
    if (missing.length > 0) edit.setChosen("variant", [...chosen, ...missing]);
  }, [variantScope, placedKeys.join("|"), chosen.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // What no group claims.
  const stepLeft = useMemo(() => leftovers(defs, step), [defs, step]);
  const split = useMemo(() => splitLeftovers(defs, step, (d) => (variantScope ? false : hasProductValue(doc, d))), [defs, step, variantScope, doc]);
  const extraChosen = stepLeft.filter((d) => chosen.includes(defKey(d)) && !split.valued.includes(d));
  const shownLeft = [...split.valued, ...extraChosen];
  const shownKeys = new Set(shownLeft.map((d) => `${d.ownerKind}|${defKey(d)}`));
  const chooserDefs = chooserDefinitions(defs, step, shownKeys);

  // Counts on the sub-tabs: how many unsaved metafield edits each holds.
  const subCounts = useMemo(() => {
    const out: Record<string, number> = {};
    if (!info.subtabs) return out;
    for (const e of Object.values(edit.edits)) {
      const t = e.target;
      if (t.kind !== "metafield" || (t.ownerKind === "PRODUCTVARIANT") !== variantScope) continue;
      const def = defs.find((d) => d.namespace === t.namespace && d.key === t.key);
      if (!def) continue;
      const s = subOfMetafield(def);
      if (s) out[s] = (out[s] ?? 0) + 1;
    }
    return out;
  }, [edit.edits, defs, variantScope, info.subtabs]);

  if (defsLazy.status === "error") {
    return (
      <s-stack gap="base">
        <StepHeading step={step} sub={sub} />
        <s-banner tone="critical" heading="Could not read the metafield definitions">
          <s-paragraph>{defsLazy.error}</s-paragraph>
          <s-button slot="secondary-actions" onClick={defsLazy.reload}>
            Try again
          </s-button>
        </s-banner>
      </s-stack>
    );
  }
  if (defsLazy.status !== "ready") return <Loading message="Reading the metafield definitions…" />;

  const loadingVariants = variantScope && placedKeys.some((k) => doc.variants.some((v) => !(k in v.metafields)));

  const row = (def: Definition, ownerId: string, variantName?: string, onRemove?: () => void) => (
    <MetafieldRow key={`${ownerId}-${defKey(def)}`} edit={edit} shared={shared} doc={doc} def={def} ownerId={ownerId} ownerKind={def.ownerKind} variantName={variantName} onRemove={onRemove} noTranslations={noTr} />
  );

  const copyFirstToAll = (def: Definition) => {
    const first = doc.variants[0];
    if (!first) return;
    const value = edit.effectiveValue(metafieldTarget(doc, def, first.id));
    for (const v of doc.variants.slice(1)) {
      const t = metafieldTarget(doc, def, v.id);
      const drafts = draftsFromStored(def.type, value, def.validations, edit.labels);
      const built = storedFromDrafts(def.type, drafts, def.validations);
      edit.putDrafts(t, drafts, { value: built.value, error: built.error });
    }
  };

  const defBlock = (def: Definition, onRemove?: () => void) => {
    if (!variantScope) return row(def, doc.id, undefined, onRemove);
    return (
      <s-section key={defKey(def)} heading={def.name}>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-text color="subdued">{def.description || `${defKey(def)}`}</s-text>
            <s-stack direction="inline" gap="small-200">
              {doc.variants.length > 1 ? (
                <s-button variant="tertiary" onClick={() => copyFirstToAll(def)}>
                  {`Copy ${variantTitle(doc.variants[0]!)} to all variants`}
                </s-button>
              ) : null}
              {onRemove ? (
                <s-button variant="tertiary" onClick={onRemove}>
                  Hide this field
                </s-button>
              ) : null}
            </s-stack>
          </s-stack>
          {doc.variants.map((v) => row(def, v.id, variantTitle(v)))}
        </s-stack>
      </s-section>
    );
  };

  const hidden = (d: Definition) => step === "leadTimes" && !showAll && kind === "made_to_order" && isStockDelivery(d) && !hasProductValue(doc, d);
  const groups = placed.map((p) => ({ ...p, defs: p.defs.filter((d) => !hidden(d)) })).filter((p) => p.defs.length > 0);
  const hiddenCount = step === "leadTimes" ? placed.reduce((n, p) => n + p.defs.filter(hidden).length, 0) : 0;
  const nothing = groups.length === 0 && (!showLeftovers || shownLeft.length === 0);

  return (
    <s-stack gap="base">
      <StepHeading step={step} sub={sub} />
      {info.subtabs ? <SubTabs step={step} sub={sub} onSub={(id) => edit.setSub(id)} counts={subCounts} /> : null}
      {loadingVariants ? <Loading message="Reading the variants' values…" /> : null}
      {step === "leadTimes" ? (
        <s-section>
          <s-stack gap="small-200">
            <s-text color="subdued">{kind === "stock" ? "This product is kept in stock, so the stock delivery time is shown." : "This product is made to order, so the stock delivery time is hidden."}</s-text>
            {hiddenCount > 0 || showAll ? <s-checkbox checked={showAll || undefined} label="Show every delivery field" ref={onChecked(setShowAll)} /> : null}
          </s-stack>
        </s-section>
      ) : null}

      {nothing ? (
        <s-section>
          <s-text color="subdued">
            {variantScope
              ? "No fields of this kind are defined for variants in this store. Use Add another field to pick any variant metafield."
              : "No fields of this kind are defined in this store yet. Use Add another metafield to pick one, or define them in Shopify."}
          </s-text>
        </s-section>
      ) : null}

      {groups.map((p) => (
        <s-stack key={p.group.id} gap="base">
          {groups.length > 1 || !info.subtabs ? (
            <s-stack gap="small-100">
              <s-heading>{p.group.title}</s-heading>
              <s-text color="subdued">{p.group.hint}</s-text>
            </s-stack>
          ) : null}
          {p.defs.map((d) => defBlock(d))}
        </s-stack>
      ))}

      {showLeftovers && shownLeft.length > 0 ? (
        <s-stack gap="base">
          <s-heading>Other fields</s-heading>
          {shownLeft.map((d) => defBlock(d, split.valued.includes(d) ? undefined : () => edit.setChosen(chosenKind, chosen.filter((k) => k !== defKey(d)))))}
        </s-stack>
      ) : null}

      {showLeftovers && chooserDefs.length > 0 ? (
        <div>
          <s-button onClick={() => setChoosing(true)}>{variantScope ? "Add another field" : "Add another metafield"}</s-button>
        </div>
      ) : null}

      {choosing ? (
        <MetafieldChooser
          heading={variantScope ? "Add variant fields" : "Add metafields"}
          defs={[...extraChosen, ...chooserDefs]}
          chosen={extraChosen.map(defKey)}
          onClose={() => setChoosing(false)}
          onDone={(keys) => {
            const mine = new Set(stepLeft.map(defKey));
            edit.setChosen(chosenKind, [...chosen.filter((k) => !mine.has(k)), ...keys]);
            setChoosing(false);
          }}
        />
      ) : null}
    </s-stack>
  );
}
