import { useMemo, useRef, useState } from "react";
import { applyMove, type MoveResult, type Progress } from "../lib/applyMove";
import { summarizeCodes } from "../lib/countries";
import { onChecked } from "../lib/dom";
import { planMove, type VisibilityMode } from "../lib/move";
import type { Shipper } from "../lib/overview";
import type { Market, Membership, ProductRow } from "../lib/types";
import { Loading } from "./Loading";
import { useGuard } from "./PasswordGate";
import { SelectField } from "./SelectField";

type Step = "review" | "applying" | "done";

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
  target,
  shippers,
  markets,
  onBack,
  onFinished,
}: {
  products: ProductRow[];
  membership: Membership;
  target: Shipper;
  shippers: Shipper[];
  markets: Market[];
  onBack: () => void;
  /** Called when the person leaves the result, so the app can reload. */
  onFinished: () => void;
}) {
  const [mode, setMode] = useState<VisibilityMode>("full");
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState<Step>("review");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<MoveResult | null>(null);
  const [crash, setCrash] = useState("");
  const stop = useRef(false);
  const guard = useGuard();

  const plan = useMemo(
    () => planMove({ products, membership, target, shippers, markets, mode }),
    [products, membership, target, shippers, markets, mode],
  );

  const run = async () => {
    stop.current = false;
    setStep("applying");
    setCrash("");
    try {
      const r = await applyMove(plan, { onProgress: setProgress, shouldStop: () => stop.current });
      setResult(r);
    } catch (err) {
      setCrash(err instanceof Error ? err.message : String(err));
    }
    setStep("done");
  };

  if (step === "applying") {
    return (
      <s-section heading="Step 3 of 3 · Applying">
        <s-stack gap="base">
          <Loading
            message={
              progress
                ? `${progress.phase === "shipping" ? "Moving shipping profiles" : "Updating catalogues"}… ${progress.done} of ${progress.total}`
                : "Starting…"
            }
          />
          <s-text color="subdued">Keep this page open. Changes already made stay if you stop.</s-text>
          <div>
            <s-button onClick={() => (stop.current = true)}>Stop</s-button>
          </div>
        </s-stack>
      </s-section>
    );
  }

  if (step === "done") {
    const failures = result?.failures ?? [];
    return (
      <s-section heading="Step 3 of 3 · Result">
        <s-stack gap="base">
          {crash ? (
            <s-banner tone="critical" heading="The move stopped with an error">
              <s-paragraph>{crash}</s-paragraph>
              <s-paragraph>Some changes may already be applied. Check the Overview.</s-paragraph>
            </s-banner>
          ) : result ? (
            <s-banner
              tone={failures.length > 0 || result.stopped ? "warning" : "success"}
              heading={result.stopped ? "Stopped before finishing" : failures.length > 0 ? "Finished with problems" : "Done"}
            >
              <s-paragraph>
                {`${result.shippingMoved} product${result.shippingMoved === 1 ? "" : "s"} moved to ${target.name}. ${result.published} catalogue publish${result.published === 1 ? "" : "es"}, ${result.unpublished} unpublish${result.unpublished === 1 ? "" : "es"}.`}
              </s-paragraph>
            </s-banner>
          ) : null}
          {failures.length > 0 ? (
            <s-table>
              <s-table-header-row>
                <s-table-header>Product</s-table-header>
                <s-table-header>What went wrong</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {failures.map((f) => (
                  <s-table-row key={f.productId}>
                    <s-table-cell>{f.title}</s-table-cell>
                    <s-table-cell>{f.message}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : null}
          <div>
            <s-button variant="primary" onClick={onFinished}>
              Back to products
            </s-button>
          </div>
        </s-stack>
      </s-section>
    );
  }

  const shown = plan.lines.slice(0, SHOWN);

  return (
    <s-stack gap="large-100">
      {guard.modal}
      <s-section heading="Step 2 of 3 · Review. Nothing has changed yet.">
        <s-stack gap="base">
          <s-paragraph>
            {`${products.length} selected product${products.length === 1 ? "" : "s"} → ${target.name}`}
          </s-paragraph>

          <SelectField
            label="Catalogues"
            value={mode}
            onChange={(v) => {
              setMode(v as VisibilityMode);
              setConfirmed(false);
            }}
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

      <s-section heading="Apply">
        <s-stack gap="base">
          <s-checkbox
            label="I have reviewed this. It changes the live store."
            checked={confirmed || undefined}
            disabled={plan.blocker ? true : undefined}
            ref={onChecked(setConfirmed)}
          />
          <s-stack direction="inline" gap="base">
            <s-button onClick={onBack}>Back</s-button>
            <s-button
              variant="primary"
              disabled={!confirmed || plan.blocker ? true : undefined}
              onClick={() => guard.ask(run)}
            >
              Apply changes
            </s-button>
          </s-stack>
          {plan.blocker ? null : !confirmed ? (
            <s-text color="subdued">Tick the box to enable Apply.</s-text>
          ) : null}
        </s-stack>
      </s-section>
    </s-stack>
  );
}
