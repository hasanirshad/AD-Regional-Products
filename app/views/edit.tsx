import { useMemo, useState } from "react";
import { ChangesBar } from "../components/editor/ChangesBar";
import type { TabProps } from "../components/editor/EditTabs";
import { ProductPicker } from "../components/editor/ProductPicker";
import { ReviewScreen } from "../components/editor/ReviewScreen";
import { CreateStart } from "../components/editor/steps/CreateStart";
import { CuratedStep, type CuratedStepId } from "../components/editor/steps/CuratedStep";
import { InfoStep } from "../components/editor/steps/InfoStep";
import { InventoryStep } from "../components/editor/steps/InventoryStep";
import { PublishingStep } from "../components/editor/steps/PublishingStep";
import { ReviewStep } from "../components/editor/steps/ReviewStep";
import { SeoStep } from "../components/editor/steps/SeoStep";
import { StepFooter } from "../components/editor/steps/StepFooter";
import { StepStrip } from "../components/editor/steps/StepStrip";
import { VariantsStep, optionsStatus } from "../components/editor/steps/VariantsStep";
import { UndoBar } from "../components/editor/UndoBar";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { liveGql } from "../lib/editor/gql";
import { gidNumber, STATUS_LABEL } from "../lib/editor/model";
import { normalizeStep, stepAfter, stepInfo, type StepId } from "../lib/editor/productSteps";
import { saveDraftState } from "../lib/editor/settings";
import { useStartEditor } from "./editor-state";
import { useAppState } from "./state";

const tone = (status: string) => (status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral");

/**
 * Product Edits: make a draft product or edit an existing one, in the same steps. The strip at the top opens any step at
 * any time. "Save and next" shows a review of what changed, asks for the password, saves, and moves on. The product is
 * always saved as it is (a new one as a draft); this page never makes a product active.
 */
export default function ProductEdits() {
  const { edit, editor: shared, products } = useAppState();
  useStartEditor(shared, ["info", "productDefs", "variantDefs", "settings"]);
  const [optionsRun, setOptionsRun] = useState(false);
  const [advance, setAdvance] = useState<StepId | null>(null);

  const doc = edit.doc;
  const pendingIds = useMemo(() => new Set(Object.values(edit.edits).map((e) => e.target.productId)), [edit.edits]);
  const knownTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products.rows) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [products.rows]);

  const options = optionsStatus(edit);

  // The number waiting in each step: edits by the step they belong to, and the options on the Variants step.
  const counts = useMemo(() => {
    const out: Partial<Record<StepId, number>> = {};
    if (!doc) return out;
    for (const e of Object.values(edit.edits)) {
      if (e.target.productId !== doc.id) continue;
      const s = edit.stepOf(e.target);
      out[s] = (out[s] ?? 0) + 1;
    }
    if (options.waiting > 0) out.variants = (out.variants ?? 0) + options.waiting;
    return out;
  }, [doc, edit.edits, edit.stepOf, options.waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const shell = (children: React.ReactNode) => (
    <s-page heading="Product Edits" inlineSize="large">
      <PageBody maxWidth={1180}>
        <s-stack gap="large-100">{children}</s-stack>
      </PageBody>
    </s-page>
  );

  // ---- review and undo
  if (edit.mode === "review" || edit.mode === "undo") {
    const productId = edit.productId;
    const keepPlace = edit.mode === "review" && edit.entry === "create" && doc?.status === "DRAFT" && productId;
    const mine = productId ? edit.built.changes.filter((c) => c.productId === productId).length : 0;
    return shell(
      <ReviewScreen
        kind={edit.mode === "undo" ? "undo" : "save"}
        edit={edit}
        shared={shared}
        products={products}
        applyLabel={undefined}
        afterRun={
          keepPlace
            ? async (summary) => {
                if (!summary.applied.some((c) => c.productId === productId)) return;
                await saveDraftState(liveGql, productId, { step: advance ?? edit.step, product: edit.chosen.product, variant: edit.chosen.variant, savedAt: new Date().toISOString() }).catch(() => undefined);
              }
            : undefined
        }
        onClose={(saved, appliedIds) => {
          const wasReview = edit.mode === "review";
          edit.setMode("edit");
          if (appliedIds.length) edit.discard(appliedIds);
          if (saved.length) void edit.refresh(saved);
          // Move on only when everything for this product was saved; otherwise stay where the problem is.
          const ok = productId !== null && saved.includes(productId) && appliedIds.length >= mine;
          if (wasReview && advance && ok) edit.go(advance);
          setAdvance(null);
        }}
      />,
    );
  }

  const goTo = (issue: { id?: string | null }) => {
    const e = issue.id ? edit.edits[issue.id] : undefined;
    if (!e) return;
    void edit.open(e.target.productId);
    edit.go(edit.stepOf(e.target));
  };

  const summary = Object.entries(counts)
    .map(([s, n]) => `${stepInfo(s as StepId).label} ${n}`)
    .join(" · ");
  const bar = (
    <ChangesBar
      edits={edit.edits}
      built={edit.built}
      onReview={() => edit.setMode("review")}
      onDiscard={edit.discardAll}
      onGoTo={goTo}
      primary={false}
      reviewLabel="Review all changes"
      summary={doc && summary ? summary : undefined}
      goLabel={(issue) => {
        const e = issue.id ? edit.edits[issue.id] : undefined;
        return e ? `Go to ${stepInfo(edit.stepOf(e.target)).label}` : "Go to the field";
      }}
    />
  );

  // The toggle at the top: make a new product, or edit one that exists.
  const toggle = (
    <s-section>
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-button
          variant={edit.entry === "create" ? "primary" : "secondary"}
          accessibilityLabel={`Create${edit.entry === "create" ? " (chosen)" : ""}`}
          onClick={() => {
            if (edit.entry !== "create") {
              edit.setEntry("create");
              edit.close();
            }
          }}
        >
          Create
        </s-button>
        <s-button
          variant={edit.entry === "edit" ? "primary" : "secondary"}
          accessibilityLabel={`Edit${edit.entry === "edit" ? " (chosen)" : ""}`}
          onClick={() => {
            if (edit.entry !== "edit") {
              edit.setEntry("edit");
              edit.close();
            }
          }}
        >
          Edit
        </s-button>
        <s-text color="subdued">{edit.entry === "create" ? "Make a new draft product, step by step." : "Find a product and change any step."}</s-text>
      </s-stack>
    </s-section>
  );

  // ---- no product open
  if (!doc || !edit.productId) {
    return shell(
      <>
        <UndoBar shared={shared} onUndo={() => edit.setMode("undo")} />
        {bar}
        {toggle}
        {shared.info.status === "error" ? (
          <s-banner tone="critical" heading="Could not read your store's languages">
            <s-paragraph>{shared.info.error}</s-paragraph>
            <s-button slot="secondary-actions" onClick={shared.info.reload}>
              Try again
            </s-button>
          </s-banner>
        ) : shared.info.status !== "ready" ? (
          <Loading message="Reading your store's languages…" />
        ) : edit.entry === "create" ? (
          <CreateStart
            edit={edit}
            shared={shared}
            onCreated={(id) => {
              edit.setEntry("create");
              void edit.open(id);
              edit.go("info");
              void shared.settings.reload();
            }}
            onContinue={(d) => {
              edit.setChosen("product", d.state.product);
              edit.setChosen("variant", d.state.variant);
              edit.setEntry("create");
              void edit.open(d.id);
              edit.go(normalizeStep(d.state.step) ?? "info");
            }}
          />
        ) : (
          <ProductPicker
            shared={shared}
            current={edit.productId}
            pendingIds={pendingIds}
            onPick={(id) => {
              void edit.open(id);
              edit.go("info");
            }}
          />
        )}
        {edit.loading ? <Loading message="Reading the product…" /> : null}
        {edit.error ? (
          <s-banner tone="critical" heading="Could not read the product">
            <s-paragraph>{edit.error}</s-paragraph>
          </s-banner>
        ) : null}
      </>,
    );
  }

  // ---- a product is open
  const props: TabProps = { edit, shared, doc, knownTags, statusLocked: true };
  const title = edit.effectiveValue({ kind: "product", productId: doc.id, field: "title" }) ?? doc.title;
  const store = shared.info.data?.domain.replace(/\.myshopify\.com$/, "") ?? "";
  const step = edit.step;
  const waiting = (counts[step] ?? 0) + 0;
  const productChanges = edit.built.changes.filter((c) => c.productId === doc.id).length;
  const blocked = edit.built.errors.length > 0 || (step === "variants" && options.problems.length > 0);

  // The run of the options is a screen of its own (it is reviewed and confirmed like any save).
  if (optionsRun) {
    return shell(
      <VariantsStep
        edit={edit}
        shared={shared}
        doc={doc}
        running
        setRunning={setOptionsRun}
        onSaved={() => {
          // Other edits of this product may be waiting: show their review before moving on.
          if (advance) {
            if (edit.built.changes.some((c) => c.productId === doc.id)) edit.setMode("review");
            else {
              edit.go(advance);
              setAdvance(null);
            }
          }
        }}
      />,
    );
  }

  const next = stepAfter(step);
  const saveAndNext = () => {
    if (step === "variants" && options.waiting > 0) {
      setAdvance(next);
      setOptionsRun(true);
      return;
    }
    if (productChanges > 0) {
      setAdvance(next);
      edit.setMode("review");
      return;
    }
    edit.go(next);
  };

  const body = () => {
    switch (step) {
      case "info":
        return <InfoStep {...props} />;
      case "variants":
        return <VariantsStep edit={edit} shared={shared} doc={doc} running={false} setRunning={setOptionsRun} onSaved={() => undefined} />;
      case "inventory":
        return <InventoryStep edit={edit} shared={shared} doc={doc} />;
      case "variantOptions":
      case "productOptions":
      case "content":
      case "leadTimes":
      case "files":
        return <CuratedStep edit={edit} shared={shared} doc={doc} step={step as CuratedStepId} />;
      case "seo":
        return <SeoStep {...props} />;
      case "publishing":
        return <PublishingStep {...props} />;
      case "review":
        return <ReviewStep edit={edit} shared={shared} doc={doc} />;
    }
  };

  return shell(
    <>
      <UndoBar shared={shared} onUndo={() => edit.setMode("undo")} />
      {bar}
      {toggle}
      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-heading>{title}</s-heading>
              <s-badge tone={tone(doc.status)}>{STATUS_LABEL[doc.status] ?? doc.status}</s-badge>
              <s-text color="subdued">{doc.handle}</s-text>
              {store ? (
                <s-link href={`https://admin.shopify.com/store/${store}/products/${gidNumber(doc.id)}`} target="_blank">
                  Open in Shopify
                </s-link>
              ) : null}
              {doc.previewUrl ? (
                <s-link href={doc.previewUrl} target="_blank">
                  Preview
                </s-link>
              ) : null}
            </s-stack>
            <s-button variant="tertiary" onClick={edit.close}>
              {edit.entry === "create" ? "Leave the steps (the draft is kept)" : "Choose another product"}
            </s-button>
          </s-stack>
          <StepStrip current={step} counts={counts} onGo={(s) => edit.go(s)} />
        </s-stack>
      </s-section>

      {edit.error ? (
        <s-banner tone="critical" heading="Something could not be read">
          <s-paragraph>{edit.error}</s-paragraph>
        </s-banner>
      ) : null}
      {doc.variantsTruncated ? <s-banner tone="warning">This product has more variants than the editor reads at once. Only the first ones are shown.</s-banner> : null}

      {body()}

      <StepFooter
        step={step}
        waiting={waiting}
        blocked={blocked}
        onBack={() => edit.go(stepAfter(step, -1))}
        onSaveNext={saveAndNext}
        note={
          step === "review"
            ? undefined
            : waiting > 0
              ? "Saving shows a review first, then asks for the password. The product stays as it is: a new product stays a draft."
              : "Nothing to save on this step."
        }
      />
    </>,
  );
}
