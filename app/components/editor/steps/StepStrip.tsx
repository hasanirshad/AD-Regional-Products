// The strip of steps at the top of Product Edits. It is the same for a new product and an existing one, and every step
// can be opened at any time. Each step shows how many edits are waiting in it, so nothing is left behind unnoticed.

import { STEPS, stepInfo, stepIndex, type StepId } from "../../../lib/editor/productSteps";

export function StepStrip({ current, counts, onGo }: { current: StepId; counts: Partial<Record<StepId, number>>; onGo: (s: StepId) => void }) {
  const at = stepIndex(current);
  return (
    <nav aria-label="Steps" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {STEPS.map((s, i) => {
        const here = s.id === current;
        const n = counts[s.id] ?? 0;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={here ? "step" : undefined}
            onClick={() => onGo(s.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px 6px 6px",
              borderRadius: 999,
              border: `1px solid ${here ? "var(--p-color-border-emphasis, #303030)" : "var(--p-color-border, #d0d0d0)"}`,
              background: here ? "var(--p-color-bg-surface-selected, #f1f1f1)" : "var(--p-color-bg-surface, #fff)",
              color: "var(--p-color-text, #303030)",
              cursor: "pointer",
              font: "inherit",
              fontWeight: here ? 650 : 450,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                background: here ? "var(--p-color-bg-fill-brand, #303030)" : i < at ? "var(--p-color-bg-fill-success, #29845a)" : "var(--p-color-bg-fill-secondary, #e3e3e3)",
                color: here || i < at ? "#fff" : "var(--p-color-text, #303030)",
              }}
            >
              {i < at ? "✓" : i + 1}
            </span>
            <span>{s.label}</span>
            {n > 0 ? (
              <span aria-label={`${n} unsaved`} style={{ minWidth: 20, textAlign: "center", fontSize: 12, borderRadius: 999, padding: "0 6px", background: "var(--p-color-bg-fill-info, #0b6bcb)", color: "#fff" }}>
                {n}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/** The two screens inside a step, when it has them. */
export function SubTabs({ step, sub, onSub, counts }: { step: StepId; sub: string | null; onSub: (id: string) => void; counts?: Record<string, number> }) {
  const tabs = stepInfo(step).subtabs;
  if (!tabs) return null;
  const active = sub ?? tabs[0]!.id;
  return (
    <s-stack direction="inline" gap="small-200">
      {tabs.map((t) => (
        <s-button key={t.id} variant={t.id === active ? "secondary" : "tertiary"} onClick={() => onSub(t.id)}>
          {counts?.[t.id] ? `${t.label} (${counts[t.id]})` : t.label}
        </s-button>
      ))}
    </s-stack>
  );
}

/** The heading of a step: its number, name and one line on what to do. */
export function StepHeading({ step, sub }: { step: StepId; sub?: string | null }) {
  const info = stepInfo(step);
  const subTab = info.subtabs?.find((t) => t.id === (sub ?? info.subtabs![0]!.id));
  return (
    <s-stack gap="small-100">
      <s-heading>{`${stepIndex(step) + 1}. ${info.label}${subTab ? ` · ${subTab.label}` : ""}`}</s-heading>
      <s-text color="subdued">{subTab ? subTab.hint : info.hint}</s-text>
    </s-stack>
  );
}
