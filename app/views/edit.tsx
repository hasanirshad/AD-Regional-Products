import { useMemo, useState } from "react";
import { BasicTab, InventoryTab, PricesTab, SeoTab, TagsTab, TypeTab, type TabProps } from "../components/editor/EditTabs";
import { ChangesBar } from "../components/editor/ChangesBar";
import { CreateStart, StepStrip, VariantsStep } from "../components/editor/CreateWizard";
import { MetafieldsTab } from "../components/editor/MetafieldsTab";
import { ProductPicker } from "../components/editor/ProductPicker";
import { ReviewScreen } from "../components/editor/ReviewScreen";
import { UndoBar } from "../components/editor/UndoBar";
import { Loading } from "../components/Loading";
import { PageBody } from "../components/PageBody";
import { useGuard } from "../components/PasswordGate";
import { clearDraftState, nextStep } from "../lib/editor/create";
import { countByTab, editsOfProduct } from "../lib/editor/edits";
import { liveGql, messageOf } from "../lib/editor/gql";
import { gidNumber, STATUS_LABEL, TABS, tabOf, type Issue, type TabId } from "../lib/editor/model";
import type { RunSummary } from "../lib/editor/run";
import { CREATE_STEPS, listDrafts, saveDraftState, type CreateStep, type UnfinishedDraft } from "../lib/editor/settings";
import { useStartEditor } from "./editor-state";
import { useAppState } from "./state";

const tone = (status: string) => (status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral");

// Edit product: pick a product, edit it in tabs (every field next to its translations), see all the changes in one bar,
// review them once, confirm once, enter the password once. Reading is free; nothing is written before the review.
export default function EditProduct() {
  const { edit, editor: shared, products } = useAppState();
  useStartEditor(shared, ["info", "productDefs", "variantDefs", "settings"]);
  const guard = useGuard();
  const [finishing, setFinishing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<{ status: "idle" | "loading" | "ready" | "error"; list: UnfinishedDraft[]; error: string }>({ status: "idle", list: [], error: "" });
  const [progressError, setProgressError] = useState("");

  const doc = edit.doc;
  const create = edit.create;
  const pendingIds = useMemo(() => new Set(Object.values(edit.edits).map((e) => e.target.productId)), [edit.edits]);
  const knownTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products.rows) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [products.rows]);

  const shell = (children: React.ReactNode) => (
    <s-page heading="Edit product" inlineSize="large">
      <PageBody maxWidth={1180}>
        <s-stack gap="large-100">{children}</s-stack>
      </PageBody>
      {guard.modal}
    </s-page>
  );

  // ---- review and undo
  if (edit.mode === "review" || edit.mode === "undo") {
    const statusKey = create ? `p|${create.productId}|status` : "";
    const statusApplied = (ids: string[]) => ids.includes(statusKey);
    const createAfter = create
      ? async (summary: RunSummary) => {
          if (!summary.applied.some((c) => c.productId === create.productId)) return;
          if (finishing) {
            if (summary.applied.some((c) => c.id === statusKey)) await clearDraftState(liveGql, create.productId);
          } else {
            await saveDraftState(liveGql, create.productId, { step: nextStep(CREATE_STEPS, create.step), product: edit.chosen.product, variant: edit.chosen.variant, savedAt: new Date().toISOString() });
          }
        }
      : undefined;
    return shell(
      <ReviewScreen
        kind={edit.mode === "undo" ? "undo" : "save"}
        edit={edit}
        shared={shared}
        products={products}
        applyLabel={finishing ? "Save and make the product active" : undefined}
        intro={finishing ? "This makes the product active: it is sold and visible once it is published to your markets." : undefined}
        afterRun={edit.mode === "undo" ? undefined : createAfter}
        onClose={(saved, appliedIds) => {
          edit.setMode("edit");
          if (appliedIds.length) edit.discard(appliedIds);
          if (saved.length) void edit.refresh(saved);
          if (create && edit.mode === "review") {
            if (finishing) {
              if (statusApplied(appliedIds)) {
                edit.setCreate(null);
                products.reload();
                setNotice(`${edit.docs[create.productId]?.title ?? "The product"} is now active. Publish it to your markets with Channels & catalogues.`);
              } else {
                edit.discard([statusKey]);
              }
              setFinishing(false);
            } else if (saved.includes(create.productId)) {
              edit.setCreate({ productId: create.productId, step: nextStep(CREATE_STEPS, create.step) });
            }
          }
        }}
      />,
    );
  }

  const goTo = (issue: Issue) => {
    const e = issue.id ? edit.edits[issue.id] : undefined;
    if (!e) return;
    void edit.open(e.target.productId);
    edit.setTab(tabOf(e.target));
  };

  const bar = (
    <ChangesBar
      edits={edit.edits}
      built={edit.built}
      onReview={() => edit.setMode("review")}
      onDiscard={edit.discardAll}
      onGoTo={goTo}
      primary={!create}
    />
  );

  // ---- create product: the basics form
  if (starting) {
    return shell(
      <CreateStart
        edit={edit}
        shared={shared}
        onCancel={() => setStarting(false)}
        onCreated={(id) => {
          setStarting(false);
          edit.setCreate({ productId: id, step: "seo" });
          void edit.open(id);
          void shared.settings.reload();
        }}
      />,
    );
  }

  const loadDrafts = async () => {
    setDrafts({ status: "loading", list: [], error: "" });
    try {
      setDrafts({ status: "ready", list: await listDrafts(liveGql), error: "" });
    } catch (e) {
      setDrafts({ status: "error", list: [], error: messageOf(e) });
    }
  };

  // ---- no product open
  if (!doc || !edit.productId) {
    return shell(
      <>
        <UndoBar shared={shared} onUndo={() => edit.setMode("undo")} />
        {bar}
        {notice ? (
          <s-banner tone="success" heading="Done">
            <s-paragraph>{notice}</s-paragraph>
          </s-banner>
        ) : null}
        {shared.info.status === "error" ? (
          <s-banner tone="critical" heading="Could not read your store's languages">
            <s-paragraph>{shared.info.error}</s-paragraph>
            <s-button slot="secondary-actions" onClick={shared.info.reload}>
              Try again
            </s-button>
          </s-banner>
        ) : shared.info.status !== "ready" ? (
          <Loading message="Reading your store's languages…" />
        ) : (
          <ProductPicker shared={shared} current={edit.productId} pendingIds={pendingIds} onPick={(id) => void edit.open(id)} />
        )}
        {edit.loading ? <Loading message="Reading the product…" /> : null}
        {edit.error ? (
          <s-banner tone="critical" heading="Could not read the product">
            <s-paragraph>{edit.error}</s-paragraph>
          </s-banner>
        ) : null}
        <s-section heading="New product">
          <s-stack gap="base">
            <s-text color="subdued">Create a product in steps. It stays a draft until you finish the last step and confirm. You can stop at any step.</s-text>
            <s-stack direction="inline" gap="small-200">
              <s-button disabled={shared.info.status !== "ready" || undefined} onClick={() => setStarting(true)}>
                Create product
              </s-button>
              <s-button disabled={drafts.status === "loading" || undefined} onClick={() => void loadDrafts()}>
                Continue where I left off
              </s-button>
            </s-stack>
            {drafts.status === "loading" ? <Loading message="Looking for unfinished products…" /> : null}
            {drafts.status === "error" ? <s-text tone="critical">{drafts.error}</s-text> : null}
            {drafts.status === "ready" && drafts.list.length === 0 ? <s-text color="subdued">No unfinished products.</s-text> : null}
            {drafts.list.map((d) => (
              <s-stack key={d.id} direction="inline" gap="small-200" alignItems="center">
                <s-text>{d.title}</s-text>
                <s-text color="subdued">{`Step: ${CREATE_STEPS.find((s) => s.id === d.state.step)?.label ?? d.state.step}`}</s-text>
                <s-button
                  onClick={() => {
                    edit.setChosen("product", d.state.product);
                    edit.setChosen("variant", d.state.variant);
                    edit.setCreate({ productId: d.id, step: d.state.step });
                    void edit.open(d.id);
                  }}
                >
                  Continue
                </s-button>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      </>,
    );
  }

  // ---- a product is open
  const props: TabProps = { edit, shared, doc, knownTags, statusLocked: Boolean(create) };
  const mine = editsOfProduct(edit.edits, doc.id);
  const counts = countByTab(mine);
  const title = edit.effectiveValue({ kind: "product", productId: doc.id, field: "title" }) ?? doc.title;
  const store = shared.info.data?.domain.replace(/\.myshopify\.com$/, "") ?? "";

  const content = (tab: TabId) => {
    switch (tab) {
      case "basic":
        return <BasicTab {...props} />;
      case "seo":
        return <SeoTab {...props} />;
      case "productMeta":
        return <MetafieldsTab edit={edit} shared={shared} doc={doc} ownerKind="PRODUCT" />;
      case "variantMeta":
        return <MetafieldsTab edit={edit} shared={shared} doc={doc} ownerKind="PRODUCTVARIANT" />;
      case "type":
        return <TypeTab {...props} />;
      case "inventory":
        return <InventoryTab {...props} />;
      case "tags":
        return <TagsTab {...props} />;
      case "prices":
        return <PricesTab {...props} />;
    }
  };

  const stepContent = (step: CreateStep) => {
    switch (step) {
      case "basics":
        return <BasicTab {...props} />;
      case "seo":
        return <SeoTab {...props} />;
      case "metafields":
        return <MetafieldsTab edit={edit} shared={shared} doc={doc} ownerKind="PRODUCT" />;
      case "variants":
        return <VariantsStep edit={edit} shared={shared} doc={doc} />;
      case "type":
        return <TypeTab {...props} />;
      case "tags":
        return <TagsTab {...props} />;
      case "prices":
        return <PricesTab {...props} />;
    }
  };

  const saveProgress = (advanceTo: CreateStep | null) =>
    guard.ask(async () => {
      if (!create) return;
      setProgressError("");
      try {
        await saveDraftState(liveGql, create.productId, { step: advanceTo ?? create.step, product: edit.chosen.product, variant: edit.chosen.variant, savedAt: new Date().toISOString() });
        if (advanceTo) edit.setCreate({ productId: create.productId, step: advanceTo });
      } catch (e) {
        setProgressError(`Your place was not saved: ${messageOf(e)}`);
      }
    });

  const stepIndex = create ? CREATE_STEPS.findIndex((s) => s.id === create.step) : -1;
  const last = stepIndex === CREATE_STEPS.length - 1;
  const hasWork = edit.built.changes.length > 0;

  return shell(
    <>
      <UndoBar shared={shared} onUndo={() => edit.setMode("undo")} />
      {bar}
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
            </s-stack>
            {create ? (
              <s-button variant="tertiary" onClick={() => edit.setCreate(null)}>
                Leave the steps (the draft is kept)
              </s-button>
            ) : (
              <s-button variant="tertiary" onClick={edit.close}>
                Choose another product
              </s-button>
            )}
          </s-stack>
          {create ? (
            <StepStrip current={create.step} onJump={(s) => edit.setCreate({ productId: create.productId, step: s })} />
          ) : (
            <s-stack direction="inline" gap="small-200">
              {TABS.map((t) => (
                <s-button key={t.id} variant={edit.tab === t.id ? "secondary" : "tertiary"} onClick={() => edit.setTab(t.id)}>
                  {counts[t.id] > 0 ? `${t.label} (${counts[t.id]})` : t.label}
                </s-button>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {edit.error ? (
        <s-banner tone="critical" heading="Something could not be read">
          <s-paragraph>{edit.error}</s-paragraph>
        </s-banner>
      ) : null}
      {doc.variantsTruncated ? <s-banner tone="warning">This product has more variants than the editor reads at once. Only the first ones are shown.</s-banner> : null}

      {create ? stepContent(create.step) : content(edit.tab)}

      {create ? (
        <s-section>
          <s-stack gap="small-200">
            <s-stack direction="inline" gap="small-200">
              <s-button
                disabled={stepIndex <= 0 || undefined}
                onClick={() => {
                  const prev = CREATE_STEPS[Math.max(0, stepIndex - 1)];
                  if (prev) edit.setCreate({ productId: create.productId, step: prev.id });
                }}
              >
                Back
              </s-button>
              {last ? (
                <s-button
                  variant="primary"
                  disabled={edit.built.errors.length > 0 || undefined}
                  onClick={() => {
                    setFinishing(true);
                    edit.put({ kind: "product", productId: create.productId, field: "status" }, "ACTIVE");
                    edit.setMode("review");
                  }}
                >
                  Finish and make active
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  disabled={edit.built.errors.length > 0 || undefined}
                  onClick={() => {
                    if (hasWork) edit.setMode("review");
                    else saveProgress(nextStep(CREATE_STEPS, create.step));
                  }}
                >
                  {hasWork ? "Review and save this step" : "Save my place and continue"}
                </s-button>
              )}
            </s-stack>
            <s-text color="subdued">
              {last
                ? "Finishing shows a review, then asks for the password. Only then does the product become active."
                : "Saving shows a review of this step's changes, then asks for the password. You can stop at any step and continue later."}
            </s-text>
            {progressError ? <s-text tone="critical">{progressError}</s-text> : null}
          </s-stack>
        </s-section>
      ) : null}
    </>,
  );
}

