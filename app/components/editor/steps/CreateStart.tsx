// The Create tab: a title and one button. It makes a real DRAFT product in Shopify (vendor Hardman Design), then opens the
// steps. Creating is a write, so it is reviewed, confirmed and protected by the password like any other. Unfinished
// drafts made here are listed below, so a person can pick up where they stopped.

import { useEffect, useMemo, useRef, useState } from "react";
import { createEngine, newProductProblem } from "../../../lib/editor/create";
import { liveGql, messageOf } from "../../../lib/editor/gql";
import { listDrafts, type UnfinishedDraft } from "../../../lib/editor/settings";
import { stepInfo } from "../../../lib/editor/productSteps";
import { normalizeStep } from "../../../lib/editor/productSteps";
import type { EditState } from "../../../views/edit-state";
import type { EditorShared } from "../../../views/editor-state";
import { Loading } from "../../Loading";
import { RunFlow } from "../../RunFlow";
import { TextBox } from "../TextBox";
import { DEFAULT_VENDOR } from "./InfoStep";

export function CreateStart({ edit, shared, onCreated, onContinue }: { edit: EditState; shared: EditorShared; onCreated: (id: string) => void; onContinue: (d: UnfinishedDraft) => void }) {
  const [title, setTitle] = useState("");
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const created = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<{ status: "loading" | "ready" | "error"; list: UnfinishedDraft[]; error: string }>({ status: "loading", list: [], error: "" });
  const problem = newProductProblem({ title, descriptionHtml: "", vendor: DEFAULT_VENDOR });

  useEffect(() => {
    let cancelled = false;
    listDrafts(liveGql)
      .then((list) => !cancelled && setDrafts({ status: "ready", list, error: "" }))
      .catch((e) => !cancelled && setDrafts({ status: "error", list: [], error: messageOf(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const engine = useMemo(
    () =>
      snapshot === null
        ? null
        : createEngine({
            gql: liveGql,
            product: { title: snapshot, descriptionHtml: "", vendor: DEFAULT_VENDOR },
            rows: edit.chosen,
            onCreated: (id) => {
              created.current = id;
            },
          }),
    [snapshot], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (snapshot !== null && engine) {
    return (
      <RunFlow
        engine={engine}
        action="Create draft product"
        applyLabel="Create the draft product"
        blocker={null}
        onBack={() => setSnapshot(null)}
        onFinished={() => (created.current ? onCreated(created.current) : setSnapshot(null))}
        finishLabel={created.current ? "Continue to Product info" : "Back"}
      >
        <s-section heading="Review">
          <s-stack gap="small-200">
            <s-text>This creates a new product in Shopify as a draft. It is not sold and not visible in the shop. You fill in the rest step by step, and it stays a draft.</s-text>
            <s-text>{`Title: ${snapshot.trim()}`}</s-text>
            <s-text>{`Vendor: ${DEFAULT_VENDOR}`}</s-text>
          </s-stack>
        </s-section>
      </RunFlow>
    );
  }

  return (
    <s-stack gap="base">
      <s-section heading="Create a product">
        <s-stack gap="base">
          <s-text color="subdued">Type the title and create the draft. Then you go through the steps: product info, variants, inventory, details, content, SEO, images, publishing and a review of every language.</s-text>
          <div style={{ maxWidth: 560 }}>
            <TextBox label="Product title" value={title} onChange={setTitle} placeholder="For example Oak dining table" error={title !== "" && problem ? problem : null} />
          </div>
          <div>
            <s-button variant="primary" disabled={!shared.ready || Boolean(problem) || undefined} onClick={() => setSnapshot(title)}>
              Create draft product
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Continue where I left off">
        <s-stack gap="small-200">
          {drafts.status === "loading" ? <Loading message="Looking for unfinished products…" /> : null}
          {drafts.status === "error" ? <s-text tone="critical">{drafts.error}</s-text> : null}
          {drafts.status === "ready" && drafts.list.length === 0 ? <s-text color="subdued">No unfinished products.</s-text> : null}
          {drafts.list.map((d) => {
            const step = normalizeStep(d.state.step);
            return (
              <s-stack key={d.id} direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">{d.title}</s-text>
                <s-text color="subdued">{step ? `Step: ${stepInfo(step).label}` : ""}</s-text>
                <s-button onClick={() => onContinue(d)}>Continue</s-button>
              </s-stack>
            );
          })}
        </s-stack>
      </s-section>
    </s-stack>
  );
}
