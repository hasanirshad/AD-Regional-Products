import { useMemo } from "react";
import type { PubPlan } from "../lib/channels";
import { publishEngine } from "../lib/publish";
import { RunFlow } from "./RunFlow";

const SHOWN = 50;

// Review for a channel / catalogue change. Nothing is written until the box is ticked and the password is given.
export function PublishReview({ plan, onBack, onFinished }: { plan: PubPlan; onBack: () => void; onFinished: () => void }) {
  const engine = useMemo(() => publishEngine(plan), [plan]);
  const shown = plan.lines.slice(0, SHOWN);
  return (
    <RunFlow
      engine={engine}
      action="Channels and catalogues"
      applyLabel={`Apply to ${plan.lines.length} product${plan.lines.length === 1 ? "" : "s"}`}
      blocker={plan.blocker}
      onBack={onBack}
      onFinished={onFinished}
      finishLabel="Back to products"
    >
      <s-section heading="Step 3 of 4 · Review. Nothing has changed yet.">
        <s-stack gap="base">
          <s-stack gap="small-200">
            {plan.chosen.map(({ target, op }) => (
              <s-stack key={target.id} direction="inline" gap="small-200" alignItems="center">
                <s-badge tone={op === "publish" ? "success" : "critical"}>
                  {target.kind === "channel" ? (op === "publish" ? "Enable" : "Disable") : op === "publish" ? "Add to" : "Remove from"}
                </s-badge>
                <s-text>{target.label}</s-text>
                <s-text color="subdued">{target.group}</s-text>
              </s-stack>
            ))}
          </s-stack>
          {plan.blocker ? <s-banner tone="critical" heading={plan.blocker} /> : null}
          {plan.warnings.map((w, i) => (
            <s-banner key={i} tone="warning" heading={w} />
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Stat label="Products to change" value={plan.lines.length} />
            <Stat label="Publishes" value={plan.totals.publish} />
            <Stat label="Unpublishes" value={plan.totals.unpublish} />
            <Stat label="Already as chosen" value={plan.unchanged.length} />
            <Stat label="Left out" value={plan.skipped.length} />
          </div>
        </s-stack>
      </s-section>

      <s-section heading={`Products${plan.lines.length > SHOWN ? ` (first ${SHOWN} of ${plan.lines.length})` : ""}`}>
        {shown.length === 0 ? (
          <s-paragraph color="subdued">No product would change.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Changes</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {shown.map((l) => (
                <s-table-row key={l.product.id}>
                  <s-table-cell>{l.product.title}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      {l.changes.map((c) => (
                        <s-badge key={c.target.id} tone={c.op === "publish" ? "success" : "critical"}>
                          {`${c.op === "publish" ? "+" : "−"} ${c.target.label}`}
                        </s-badge>
                      ))}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {plan.skipped.length > 0 ? (
        <s-section heading={`Left out (${plan.skipped.length})`}>
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Why</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {plan.skipped.slice(0, SHOWN).map((s) => (
                <s-table-row key={s.product.id}>
                  <s-table-cell>{s.product.title}</s-table-cell>
                  <s-table-cell>{s.reason}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ) : null}
    </RunFlow>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{String(value)}</s-heading>
      </s-stack>
    </s-box>
  );
}
