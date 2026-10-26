import { useMemo } from "react";
import { changeLabels, stockEngine, type StockPlan } from "../lib/inventory";
import { RunFlow } from "./RunFlow";

const SHOWN = 50;

// Review for an inventory change. Nothing is written until the box is ticked and the password is given.
export function InventoryReview({ plan, onBack, onFinished }: { plan: StockPlan; onBack: () => void; onFinished: () => void }) {
  const engine = useMemo(() => stockEngine(plan), [plan]);
  const s = plan.settings;
  const shown = plan.lines.slice(0, SHOWN);
  return (
    <RunFlow
      engine={engine}
      action="Inventory"
      applyLabel={`Apply to ${plan.lines.length} product${plan.lines.length === 1 ? "" : "s"}`}
      blocker={plan.blocker}
      onBack={onBack}
      onFinished={onFinished}
      finishLabel="Back to products"
    >
      <s-section heading="Step 3 of 4 · Review. Nothing has changed yet.">
        <s-stack gap="base">
          <s-stack gap="small-200">
            {s.track ? <Rule tone="success" label="Track quantity" text="Turned on for every variant." /> : null}
            {s.stopAtZero ? <Rule tone="success" label="Sold out = not available" text="Customers cannot buy a variant once its stock reaches 0." /> : null}
            {s.setQuantity ? <Rule tone="info" label={`Quantity ${s.quantity}`} text={`Set at ${plan.locationName}, for every variant.`} /> : null}
          </s-stack>
          {plan.blocker ? <s-banner tone="critical" heading={plan.blocker} /> : null}
          {plan.warnings.map((w, i) => (
            <s-banner key={i} tone="warning" heading={w} />
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Stat label="Products to change" value={plan.lines.length} />
            <Stat label="Variants to track" value={plan.totals.track} />
            <Stat label="Variants set to stop at 0" value={plan.totals.policy} />
            <Stat label="Quantities to set" value={plan.totals.quantity} />
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
              <s-table-header>Variants</s-table-header>
              <s-table-header>Changes</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {shown.map((l) => (
                <s-table-row key={l.product.id}>
                  <s-table-cell>{l.product.title}</s-table-cell>
                  <s-table-cell>{l.before.length}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      {changeLabels(l, s).map((t) => (
                        <s-badge key={t} tone="info">
                          {t}
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
              {plan.skipped.slice(0, SHOWN).map((x) => (
                <s-table-row key={x.product.id}>
                  <s-table-cell>{x.product.title}</s-table-cell>
                  <s-table-cell>{x.reason}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      ) : null}
    </RunFlow>
  );
}

function Rule({ tone, label, text }: { tone: "success" | "info"; label: string; text: string }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      <s-badge tone={tone}>{label}</s-badge>
      <s-text color="subdued">{text}</s-text>
    </s-stack>
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
