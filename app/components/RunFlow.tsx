import { useRef, useState, type ReactNode } from "react";
import type { Progress } from "../lib/applyMove";
import { onChecked } from "../lib/dom";
import type { RunEngine } from "../lib/engine";
import type { Finding } from "../lib/readback";
import { downloadCsv, reportCsv, reportFileName, reportSummary, type ReportRow } from "../lib/report";
import { Loading } from "./Loading";
import { useGuard } from "./PasswordGate";

type Stage = "review" | "checking" | "applying" | "verifying" | "drift" | "trial" | "done";

/**
 * The safe apply flow shared by every fix that changes products:
 *   tick the box -> password -> recheck the store -> (optional) first product alone -> read back -> the rest -> report.
 * `children` is the review (everything above the confirm box); nothing is written while it shows.
 */
export function RunFlow<L>({
  engine,
  action,
  applyLabel,
  blocker,
  onBack,
  onFinished,
  finishLabel,
  children,
}: {
  engine: RunEngine<L>;
  /** Names the run in the report file, e.g. "Move to DE-DHL". */
  action: string;
  applyLabel: string;
  blocker: string | null;
  onBack: () => void;
  onFinished: () => void;
  finishLabel: string;
  children: ReactNode;
}) {
  const many = engine.lines.length > 1;
  const [confirmed, setConfirmed] = useState(false);
  const [trial, setTrial] = useState(true);
  const [stage, setStage] = useState<Stage>("review");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [drift, setDrift] = useState<Finding[]>([]);
  const [rest, setRest] = useState<L[]>(engine.lines);
  const [crash, setCrash] = useState("");
  const stop = useRef(false);
  const guard = useGuard();

  const start = async (lines: L[], firstOnly: boolean, previous: ReportRow[]) => {
    stop.current = false;
    setCrash("");
    setDrift([]);
    setRows(previous);
    try {
      setStage("checking");
      const found = await engine.recheck(lines);
      if (found.length > 0) {
        setDrift(found);
        setStage("drift");
        return;
      }
      const now = firstOnly ? lines.slice(0, 1) : lines;
      const later = firstOnly ? lines.slice(1) : [];
      setStage("applying");
      const outcome = await engine.run(now, {
        onProgress: setProgress,
        shouldStop: () => stop.current,
        onStage: (s) => setStage(s),
      });
      const all = [...previous, ...outcome.rows];
      setRows(all);
      if (firstOnly && later.length > 0 && outcome.rows.every((r) => r.status === "done")) {
        setRest(later);
        setStage("trial");
        return;
      }
      if (firstOnly && later.length > 0) {
        // The first product did not come out right: stop here, do not touch the others.
        setRows([...all, ...notApplied(engine, later, "Not tried: the first product did not verify.")]);
      }
      setStage("done");
    } catch (err) {
      setCrash(err instanceof Error ? err.message : String(err));
      setStage("done");
    }
  };

  const download = () => downloadCsv(reportFileName(action), reportCsv(action, rows));

  if (stage === "checking" || stage === "applying" || stage === "verifying") {
    const text =
      stage === "checking"
        ? "Checking that nothing changed since the review…"
        : stage === "verifying"
          ? "Reading the products back from Shopify to confirm…"
          : progress
            ? `${PHASE_TEXT[progress.phase] ?? "Updating"}… ${progress.done} of ${progress.total}`
            : "Starting…";
    return (
      <s-section heading="Applying">
        <s-stack gap="base">
          <Loading message={text} />
          <s-text color="subdued">Keep this page open. Changes already made stay if you stop.</s-text>
          {stage === "applying" ? (
            <div>
              <s-button onClick={() => (stop.current = true)}>Stop after this product</s-button>
            </div>
          ) : null}
        </s-stack>
      </s-section>
    );
  }

  if (stage === "drift") {
    return (
      <s-section heading="Nothing was changed">
        <s-stack gap="base">
          <s-banner tone="warning" heading="The store changed since you built this review">
            <s-paragraph>
              {`${drift.length} product${drift.length === 1 ? "" : "s"} no longer match the review. Nothing was written. Go back, reload and review again.`}
            </s-paragraph>
          </s-banner>
          <FindingsTable findings={drift} />
          <div>
            <s-button variant="primary" onClick={onFinished}>
              {finishLabel}
            </s-button>
          </div>
        </s-stack>
      </s-section>
    );
  }

  if (stage === "trial") {
    return (
      <s-section heading="First product done and confirmed">
        <s-stack gap="base">
          {guard.modal}
          <s-banner tone="success" heading="Shopify shows the change on the first product">
            <s-paragraph>{`${rest.length === 1 ? "1 more product is" : `${rest.length} more products are`} waiting. Nothing else has been touched yet.`}</s-paragraph>
          </s-banner>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={() => guard.ask(() => start(rest, false, rows))}>
              {`Continue with ${rest.length} remaining`}
            </s-button>
            <s-button onClick={download}>Download report (CSV)</s-button>
            <s-button
              onClick={() => {
                setRows([...rows, ...notApplied(engine, rest, "Not tried: stopped after the first product.")]);
                setStage("done");
              }}
            >
              Stop here
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    );
  }

  if (stage === "done") {
    const sum = reportSummary(rows);
    const problem = sum.failed + sum["not verified"];
    const bad = rows.filter((r) => r.status === "failed" || r.status === "not verified");
    return (
      <s-section heading="Result">
        <s-stack gap="base">
          {crash ? (
            <s-banner tone="critical" heading="The run stopped with an error">
              <s-paragraph>{crash}</s-paragraph>
              <s-paragraph>Some changes may already be applied. Download the report and check the Overview.</s-paragraph>
            </s-banner>
          ) : (
            <s-banner
              tone={problem > 0 ? "critical" : sum["not applied"] > 0 ? "warning" : "success"}
              heading={problem > 0 ? "Finished with problems" : sum["not applied"] > 0 ? "Stopped before finishing" : "Done and confirmed"}
            >
              <s-paragraph>
                {`${sum.done} confirmed by Shopify · ${sum["not verified"]} not confirmed · ${sum.failed} failed · ${sum["not applied"]} not applied.`}
              </s-paragraph>
              {sum["not verified"] > 0 ? (
                <s-paragraph>
                  Not confirmed means Shopify answered "ok" but still shows the old state. Check those products in Shopify.
                </s-paragraph>
              ) : null}
            </s-banner>
          )}
          {bad.length > 0 ? (
            <s-table>
              <s-table-header-row>
                <s-table-header>Product</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>What went wrong</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {bad.map((r, i) => (
                  <s-table-row key={`${r.productId}-${i}`}>
                    <s-table-cell>{r.title}</s-table-cell>
                    <s-table-cell>{r.status}</s-table-cell>
                    <s-table-cell>{r.message}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : null}
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={onFinished}>
              {finishLabel}
            </s-button>
            {rows.length > 0 ? <s-button onClick={download}>Download report (CSV)</s-button> : null}
          </s-stack>
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-stack gap="large-100">
      {guard.modal}
      {children}
      <s-section heading="Confirm">
        <s-stack gap="base">
          <s-checkbox
            label="I have reviewed this. It changes the live store."
            checked={confirmed || undefined}
            disabled={blocker ? true : undefined}
            ref={onChecked(setConfirmed)}
          />
          {many ? (
            <s-checkbox
              label="Try the first product alone and check it before the rest"
              checked={trial || undefined}
              disabled={blocker ? true : undefined}
              ref={onChecked(setTrial)}
            />
          ) : null}
          <s-stack direction="inline" gap="base">
            <s-button onClick={onBack}>Back</s-button>
            <s-button
              variant="primary"
              disabled={!confirmed || blocker ? true : undefined}
              onClick={() => guard.ask(() => start(engine.lines, many && trial, []))}
            >
              {applyLabel}
            </s-button>
          </s-stack>
          {blocker ? null : !confirmed ? (
            <s-text color="subdued">Tick the box to enable the button. The password is asked next. Before anything is written the app checks that the store still matches this review, and afterwards it reads every product back to confirm.</s-text>
          ) : null}
        </s-stack>
      </s-section>
    </s-stack>
  );
}

const PHASE_TEXT: Record<string, string> = {
  shipping: "Moving shipping profiles",
  publishing: "Updating channels and catalogues",
  inventory: "Updating inventory",
  catalogues: "Updating catalogues",
  editing: "Saving products",
};

const notApplied = <L,>(engine: RunEngine<L>, lines: L[], message: string): ReportRow[] =>
  lines.map((l) => ({
    ...engine.describe(l),
    before: "",
    after: "",
    added: [],
    removed: [],
    status: "not applied",
    message,
  }));

function FindingsTable({ findings }: { findings: Finding[] }) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header>Product</s-table-header>
        <s-table-header>What changed</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {findings.slice(0, 50).map((f) => (
          <s-table-row key={f.productId}>
            <s-table-cell>{f.title}</s-table-cell>
            <s-table-cell>{f.message}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}
