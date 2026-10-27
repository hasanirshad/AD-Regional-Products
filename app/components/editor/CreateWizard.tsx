// Create product, in steps. Step 1 makes a real DRAFT product in Shopify (title, description, vendor). Every later step
// edits that draft with the same tabs, review, confirmation and password as any other product, so "save at any step" is
// an ordinary save. The step reached is kept in Shopify (an app metafield on the draft), which is what "Continue where
// I left off" lists. The product becomes active only on the last step, after review, confirmation and the password.

import { useMemo, useRef, useState } from "react";
import { liveGql } from "../../lib/editor/gql";
import { CREATE_STEPS, type CreateStep } from "../../lib/editor/settings";
import { combinations, createEngine, optionsEngine, optionsProblem, variantCount, type NewProduct, type OptionInput } from "../../lib/editor/create";
import type { ProductDoc } from "../../lib/editor/doc";
import { newProductProblem } from "../../lib/editor/create";
import type { EditState } from "../../views/edit-state";
import type { EditorShared } from "../../views/editor-state";
import { RunFlow } from "../RunFlow";
import { MetafieldsTab } from "./MetafieldsTab";
import { TextBox } from "./TextBox";

export function StepStrip({ current, onJump }: { current: CreateStep; onJump: (s: CreateStep) => void }) {
  const at = CREATE_STEPS.findIndex((s) => s.id === current);
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      {CREATE_STEPS.map((s, i) => (
        <s-button key={s.id} variant={i === at ? "secondary" : "tertiary"} onClick={() => onJump(s.id)} accessibilityLabel={`Step ${i + 1}: ${s.label}`}>
          {`${i + 1}. ${s.label}`}
        </s-button>
      ))}
    </s-stack>
  );
}

/** Step 1: the basics. Reviewed and confirmed like any write, because it creates a product in Shopify (as a draft). */
export function CreateStart({ edit, onCreated, onCancel }: { edit: EditState; shared: EditorShared; onCreated: (id: string) => void; onCancel: () => void }) {
  const [product, setProduct] = useState<NewProduct>({ title: "", descriptionHtml: "", vendor: "" });
  const [stage, setStage] = useState<"form" | "run">("form");
  const created = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<NewProduct | null>(null);
  const problem = newProductProblem(product);

  const engine = useMemo(
    () =>
      snapshot
        ? createEngine({
            gql: liveGql,
            product: snapshot,
            rows: edit.chosen,
            onCreated: (id) => {
              created.current = id;
            },
          })
        : null,
    [snapshot], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (stage === "run" && engine && snapshot) {
    return (
      <RunFlow
        engine={engine}
        action="Create product"
        applyLabel="Create the draft product"
        blocker={null}
        onBack={() => setStage("form")}
        onFinished={() => (created.current ? onCreated(created.current) : setStage("form"))}
        finishLabel={created.current ? "Continue to the next step" : "Back to the form"}
      >
        <s-section heading="Review">
          <s-stack gap="small-200">
            <s-text>This creates a new product in Shopify as a draft. It is not sold and not visible in your shop until you finish the last step and confirm.</s-text>
            <s-text>{`Title: ${snapshot.title.trim()}`}</s-text>
            <s-text>{`Vendor: ${snapshot.vendor.trim() || "—"}`}</s-text>
            <s-text>{`Description: ${snapshot.descriptionHtml.trim() ? `${snapshot.descriptionHtml.trim().slice(0, 200)}${snapshot.descriptionHtml.trim().length > 200 ? "…" : ""}` : "—"}`}</s-text>
          </s-stack>
        </s-section>
      </RunFlow>
    );
  }

  return (
    <s-section heading="New product · Step 1 of 7 · Basics">
      <s-stack gap="base">
        <s-text color="subdued">Start with the basics. Everything else comes in the next steps, and you can stop at any step and continue later.</s-text>
        <TextBox label="Title" value={product.title} onChange={(title) => setProduct((p) => ({ ...p, title }))} />
        <TextBox label="Vendor" value={product.vendor} onChange={(vendor) => setProduct((p) => ({ ...p, vendor }))} />
        <TextBox label="Description (HTML)" value={product.descriptionHtml} multiline rows={6} onChange={(descriptionHtml) => setProduct((p) => ({ ...p, descriptionHtml }))} />
        {product.title !== "" && problem ? <s-text tone="critical">{problem}</s-text> : null}
        <s-stack direction="inline" gap="small-200">
          <s-button onClick={onCancel}>Cancel</s-button>
          <s-button
            variant="primary"
            disabled={Boolean(problem) || undefined}
            onClick={() => {
              setSnapshot({ ...product });
              setStage("run");
            }}
          >
            Review and create the draft
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

const hasOptions = (doc: ProductDoc): boolean => doc.options.some((o) => o.name !== "Title");

/** The variants step: options (Size, Colour…) make one variant per combination; then variant metafields. */
export function VariantsStep({ edit, shared, doc }: { edit: EditState; shared: EditorShared; doc: ProductDoc }) {
  const [options, setOptions] = useState<{ name: string; values: string }[]>([{ name: "", values: "" }]);
  const [snapshot, setSnapshot] = useState<OptionInput[] | null>(null);
  const [stage, setStage] = useState<"form" | "run">("form");
  const input: OptionInput[] = options.map((o) => ({ name: o.name, values: o.values.split(",") }));
  const problem = optionsProblem(input);
  const count = variantCount(input);

  const engine = useMemo(
    () => (snapshot ? optionsEngine(liveGql, { productId: doc.id, title: doc.title, handle: doc.handle, options: snapshot }, () => undefined) : null),
    [snapshot, doc.id, doc.title, doc.handle],
  );

  if (stage === "run" && engine && snapshot) {
    const combos = combinations(snapshot);
    return (
      <RunFlow
        engine={engine}
        action="Add options and variants"
        applyLabel={`Add ${combos.length} variant${combos.length === 1 ? "" : "s"}`}
        blocker={null}
        onBack={() => setStage("form")}
        onFinished={() => {
          void edit.refresh([doc.id]);
          setStage("form");
        }}
        finishLabel="Back to the variants step"
      >
        <s-section heading="Review">
          <s-stack gap="small-200">
            <s-text>{`Shopify will create ${combos.length} variant${combos.length === 1 ? "" : "s"} for ${doc.title}:`}</s-text>
            {snapshot.map((o) => (
              <s-text key={o.name}>{`${o.name}: ${o.values.map((v) => v.trim()).filter(Boolean).join(", ")}`}</s-text>
            ))}
            <s-text color="subdued">Each variant starts with the same price as the first one. Set the prices in the Prices step.</s-text>
          </s-stack>
        </s-section>
      </RunFlow>
    );
  }

  return (
    <s-stack gap="base">
      <s-section heading="Options and variants">
        {hasOptions(doc) ? (
          <s-stack gap="small-200">
            <s-text>{`This product has ${doc.variants.length} variant${doc.variants.length === 1 ? "" : "s"}.`}</s-text>
            {doc.options.map((o) => (
              <s-text key={o.name}>{`${o.name}: ${o.values.join(", ")}`}</s-text>
            ))}
            <s-text color="subdued">Options are added once, here. To change them later, use Shopify.</s-text>
          </s-stack>
        ) : (
          <s-stack gap="base">
            <s-text color="subdued">A product with no options has one variant. If it comes in sizes or colours, add the options now: one variant is made for each combination. Skip this step if it does not.</s-text>
            {options.map((o, i) => (
              <s-stack key={i} direction="inline" gap="small-200" alignItems="end">
                <TextBox label={`Option ${i + 1} name`} value={o.name} placeholder="Size" onChange={(name) => setOptions((all) => all.map((x, j) => (j === i ? { ...x, name } : x)))} />
                <TextBox label={`Option ${i + 1} values`} value={o.values} placeholder="180 cm, 220 cm" details="Separate values with commas." onChange={(values) => setOptions((all) => all.map((x, j) => (j === i ? { ...x, values } : x)))} />
                {options.length > 1 ? (
                  <s-button variant="tertiary" tone="critical" onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}>
                    Remove
                  </s-button>
                ) : null}
              </s-stack>
            ))}
            <s-stack direction="inline" gap="small-200">
              {options.length < 3 ? <s-button onClick={() => setOptions((all) => [...all, { name: "", values: "" }])}>Add another option</s-button> : null}
            </s-stack>
            {options.some((o) => o.name.trim() || o.values.trim()) ? (
              problem ? <s-text tone="critical">{problem}</s-text> : <s-text>{`This makes ${count} variant${count === 1 ? "" : "s"}.`}</s-text>
            ) : null}
            <div>
              <s-button
                disabled={Boolean(problem) || undefined}
                onClick={() => {
                  setSnapshot(input);
                  setStage("run");
                }}
              >
                Review the variants
              </s-button>
            </div>
          </s-stack>
        )}
      </s-section>
      <MetafieldsTab edit={edit} shared={shared} doc={doc} ownerKind="PRODUCTVARIANT" />
    </s-stack>
  );
}
