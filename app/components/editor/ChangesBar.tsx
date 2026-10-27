import { useState } from "react";
import { countByTab } from "../../lib/editor/edits";
import type { EditMap } from "../../lib/editor/edits";
import type { BuiltChanges } from "../../lib/editor/changes";
import { tabLabel, tabOf, type Issue, type TabId } from "../../lib/editor/model";

/**
 * Always visible. Says how many changes are waiting and in which tabs, and has the one primary button, "Review changes".
 * Problems that block the review are listed with a button that goes to the field.
 */
export function ChangesBar({
  edits,
  built,
  onReview,
  onDiscard,
  onGoTo,
  reviewLabel = "Review changes",
  primary = true,
}: {
  edits: EditMap;
  built: BuiltChanges;
  onReview: () => void;
  onDiscard: () => void;
  /** Jumps to the field with a problem. */
  onGoTo?: (issue: Issue) => void;
  reviewLabel?: string;
  /** False when another button on the page is the main one. */
  primary?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const total = Object.keys(edits).length;
  const productCount = new Set(Object.values(edits).map((e) => e.target.productId)).size;
  const byTab = countByTab(edits);
  const tabs = (Object.keys(byTab) as TabId[]).filter((t) => byTab[t] > 0);
  const blockers = built.errors;

  return (
    <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--p-color-bg-surface, #fff)", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.15)", padding: 12 }}>
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">Changes</s-text>
            {total === 0 ? (
              <s-text color="subdued">Nothing changed yet. Edits stay here until you review and save them.</s-text>
            ) : (
              <>
                <s-badge tone="info">{`${total} unsaved`}</s-badge>
                <s-text color="subdued">{`${productCount} product${productCount === 1 ? "" : "s"} · ${tabs.map((t) => `${tabLabel(t)} ${byTab[t]}`).join(" · ")}`}</s-text>
              </>
            )}
          </s-stack>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {total > 0 && !asking ? (
              <s-button variant="tertiary" onClick={() => setAsking(true)}>
                Discard all
              </s-button>
            ) : null}
            {asking ? (
              <>
                <s-text>Throw away all unsaved changes?</s-text>
                <s-button
                  tone="critical"
                  onClick={() => {
                    setAsking(false);
                    onDiscard();
                  }}
                >
                  Yes, discard
                </s-button>
                <s-button onClick={() => setAsking(false)}>Keep</s-button>
              </>
            ) : null}
            <s-button variant={primary ? "primary" : "secondary"} disabled={total === 0 || blockers.length > 0 || undefined} onClick={onReview}>
              {reviewLabel}
            </s-button>
          </s-stack>
        </s-stack>
        {blockers.length > 0 ? (
          <s-stack gap="small-100">
            <s-text tone="critical">{blockers.length === 1 ? "One field needs fixing before you can review:" : `${blockers.length} fields need fixing before you can review:`}</s-text>
            {blockers.slice(0, 3).map((b, i) => (
              <s-stack key={`${b.id}-${i}`} direction="inline" gap="small-200" alignItems="center">
                <s-text tone="critical">{b.message}</s-text>
                {onGoTo && b.id && edits[b.id] ? (
                  <s-button variant="tertiary" onClick={() => onGoTo(b)}>
                    {`Go to ${tabLabel(tabOf(edits[b.id]!.target))}`}
                  </s-button>
                ) : null}
              </s-stack>
            ))}
            {blockers.length > 3 ? <s-text color="subdued">{`And ${blockers.length - 3} more.`}</s-text> : null}
          </s-stack>
        ) : null}
        {total > 0 ? (
          <details>
            <summary style={{ cursor: "pointer" }}>
              <s-text color="subdued">{`See the ${built.changes.length} change${built.changes.length === 1 ? "" : "s"}`}</s-text>
            </summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, maxHeight: 180, overflowY: "auto" }}>
              {built.changes.slice(0, 100).map((c) => (
                <li key={c.id}>
                  <s-text>{`${c.productTitle} · ${c.label}`}</s-text>
                </li>
              ))}
              {built.changes.length > 100 ? <li>{`And ${built.changes.length - 100} more.`}</li> : null}
            </ul>
          </details>
        ) : null}
      </s-stack>
    </div>
  );
}
