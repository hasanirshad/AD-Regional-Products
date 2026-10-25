import { useMemo, useState } from "react";
import { summarizeCodes } from "../lib/countries";
import { planMove, type VisibilityMode } from "../lib/move";
import { moveEngine } from "../lib/runPlan";
import type { Shipper } from "../lib/overview";
import type { Market, Membership, Parts, ProductRow } from "../lib/types";
import { RunFlow } from "./RunFlow";
import { SelectField } from "./SelectField";


const MODE_LABEL: Record<VisibilityMode, string> = {
  full: "Publish where it can be bought, unpublish where it cannot",
  unpublish: "Only unpublish where it cannot be bought",
  none: "Do not change catalogues",
};

const SHOWN = 50;

// Three steps: Choose (on the Products page), Review (this page, nothing is
// written), Apply (only after the box is ticked and the button pressed).
export function MoveReview({
  products,
  membership,
  parts,
  target,
  shippers,
  markets,
  onBack,
  onFinished,
}: {
  products: ProductRow[];
  membership: Membership;
  parts?: Parts;
  target: Shipper;
  shippers: Shipper[];
  markets: Market[];
  onBack: () => void;
  /** Called when the person leaves the result, so the app can reload. */
  onFinished: () => void;
}) {
  const [mode, setMode] = useState<VisibilityMode>("full");

  const plan = useMemo(
    () => planMove({ products, membership, parts, target, shippers, markets, mode }),
    [products, membership, parts, target, shippers, markets, mode],
  );

  const engine = useMemo(() => moveEngine(plan), [plan]);
  const shown = plan.lines.slice(0, SHOWN);

  return (
    <RunFlow
      key={mode}
      engine={engine}
      action={`Move to ${target.name}`}
      applyLabel="Apply changes"
      blocker={plan.blocker}
      onBack={onBack}
      onFinished={onFinished}
      finishLabel="Back to products"
    >
      <s-section heading="Step 2 of 3 · Review. Nothing has changed yet.">
        <s-stack gap="base">
          <s-paragraph>
            {`${products.length} selected product${products.length === 1 ? "" : "s"} → ${target.name}`}
          </s-paragraph>

          <SelectField
            label="Catalogues"
            value={mode}
            onChange={(v) => setMode(v as VisibilityMode)}
            options={(Object.keys(MODE_LABEL) as VisibilityMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))}
          />

          {plan.blocker ? <s-banner tone="critical" heading={plan.blocker} /> : null}
          {plan.warnings.map((w, i) => (
            <s-banner key={i} tone="warning" heading={w} />
          ))}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack gap="small-300">
                <s-text color="subdued">Shipping profile moves</s-text>
                <s-heading>{String(plan.totals.shipping)}</s-heading>
              </s-stack>
            </s-box>
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack gap="small-300">
                <s-text color="subdued">Catalogue publishes</s-text>
                <s-heading>{String(plan.totals.publish)}</s-heading>
              </s-stack>
            </s-box>
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack gap="small-300">
                <s-text color="subdued">Catalogue unpublishes</s-text>
                <s-heading>{String(plan.totals.unpublish)}</s-heading>
              </s-stack>
            </s-box>
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack gap="small-300">
                <s-text color="subdued">Nothing to change</s-text>
                <s-heading>{String(plan.unchanged.length)}</s-heading>
              </s-stack>
            </s-box>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="By market">
        <s-table>
          <s-table-header-row>
            <s-table-header>Market</s-table-header>
            <s-table-header>Checkout for {target.name}</s-table-header>
            <s-table-header>Will be published</s-table-header>
            <s-table-header>Will be unpublished</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {plan.perMarket.map((m) => (
              <s-table-row key={m.coverage.market.id}>
                <s-table-cell>{m.coverage.market.name}</s-table-cell>
                <s-table-cell>
                  {m.coverage.state === "all" ? (
                    <s-badge tone="success">All countries</s-badge>
                  ) : m.coverage.state === "none" ? (
                    <s-badge tone="critical">Blocked</s-badge>
                  ) : (
                    <s-badge tone="warning">{`Blocks ${summarizeCodes(m.coverage.blocked, 3)}`}</s-badge>
                  )}
                </s-table-cell>
                <s-table-cell>{m.publish}</s-table-cell>
                <s-table-cell>{m.unpublish}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section heading={`Products${plan.lines.length > SHOWN ? ` (first ${SHOWN} of ${plan.lines.length})` : ""}`}>
        {shown.length === 0 ? (
          <s-paragraph color="subdued">No product would change.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Shipping profile</s-table-header>
              <s-table-header>Catalogues</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {shown.map((l) => (
                <s-table-row key={l.product.id}>
                  <s-table-cell>{l.product.title}</s-table-cell>
                  <s-table-cell>{l.shippingChange ? `${l.from} → ${l.to}` : "No change"}</s-table-cell>
                  <s-table-cell>
                    {l.changes.length === 0 ? (
                      <s-text color="subdued">No change</s-text>
                    ) : (
                      <s-stack direction="inline" gap="small-300">
                        {l.changes.map((c) => (
                          <s-badge key={c.catalog.id} tone={c.kind === "publish" ? "success" : "critical"}>
                            {`${c.kind === "publish" ? "+" : "−"} ${c.market.name}`}
                          </s-badge>
                        ))}
                      </s-stack>
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

    </RunFlow>
  );
}
