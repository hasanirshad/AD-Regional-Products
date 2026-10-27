// The one Review step, for the Edit product page. It lists every change in every tab (and every product with pending
// edits), then the shared RunFlow takes over: one ticked confirmation, one password, a recheck of the store, the first
// product alone, a read-back of every field, and a CSV report. The same screen reverses the last save (Undo).

import { useMemo, useRef, useState } from "react";
import { onChecked } from "../../lib/dom";
import { rowPatchesFrom, toBundles, undoChanges } from "../../lib/editor/changes";
import { liveGql } from "../../lib/editor/gql";
import { targetKey, type Change } from "../../lib/editor/model";
import { editorEngine, type RunSummary } from "../../lib/editor/run";
import { clearUndo, saveUndo, undoRecordFrom, type UndoRecord } from "../../lib/editor/settings";
import type { EditState } from "../../views/edit-state";
import type { EditorShared } from "../../views/editor-state";
import type { ProductsLoad } from "../../views/products-state";
import { RunFlow } from "../RunFlow";
import { ChangesReview } from "./ChangesReview";

export type ReviewKind = "save" | "undo";

export function ReviewScreen({
  kind,
  edit,
  shared,
  products,
  onClose,
  extra,
  intro,
  applyLabel,
  finishLabel,
  afterRun,
}: {
  kind: ReviewKind;
  /** The changes to review (the Edit product page and Bulk edit both provide these). */
  edit: Pick<EditState, "built" | "ctx">;
  shared: EditorShared;
  products: ProductsLoad;
  /** Back to the editor. `saved` lists the product ids that were written, `appliedIds` the changes Shopify accepted. */
  onClose: (saved: string[], appliedIds: string[]) => void;
  /** More to show above the confirm box. */
  extra?: React.ReactNode;
  intro?: string;
  applyLabel?: string;
  finishLabel?: string;
  /** More to do inside the same confirmed run (for example saving the "Create product" step). */
  afterRun?: (summary: RunSummary, all: Change[]) => Promise<void>;
}) {
  const record: UndoRecord | null = kind === "undo" ? shared.undo : null;
  const [redirect, setRedirect] = useState(true);
  // The review is a snapshot: the editor is hidden while it shows, so nothing can change under it.
  const { changes, warnings, bundles } = useMemo(() => {
    if (kind === "undo" && record) {
      const c = undoChanges(record.items);
      const titles = new Map(record.items.map((i) => [i.productId, i.productTitle]));
      return { changes: c, warnings: [], bundles: toBundles(c, { productTitle: (id) => titles.get(id) ?? "Product", productHandle: () => "" }) };
    }
    return { changes: edit.built.changes, warnings: edit.built.warnings, bundles: toBundles(edit.built.changes, edit.ctx) };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applied = useRef<Change[]>([]);
  const hasHandle = changes.some((c) => c.target.kind === "product" && c.target.field === "handle");
  const action = kind === "undo" ? "Undo last save" : `Edit ${new Set(changes.map((c) => c.productId)).size} product${new Set(changes.map((c) => c.productId)).size === 1 ? "" : "s"}`;

  const engine = useMemo(
    () =>
      editorEngine({
        gql: liveGql,
        bundles,
        options: { redirectOnHandleChange: redirect },
        afterRun: async (summary) => {
          applied.current = [...applied.current, ...summary.applied];
          products.patchRows(rowPatchesFrom(summary.applied));
          const inst = shared.settings.data?.installationId;
          if (kind === "undo" && record) {
            const done = new Set(applied.current.map((c) => c.id));
            const left = record.items.filter((i) => !done.has(targetKey(i.target)));
            if (left.length === 0) {
              shared.setUndo(null);
              if (inst) await clearUndo(liveGql, inst);
            } else {
              const rest = { ...record, items: left };
              shared.setUndo(rest);
              if (inst) await saveUndo(liveGql, inst, rest);
            }
          } else if (summary.applied.length > 0) {
            const next = undoRecordFrom(action, applied.current);
            shared.setUndo(next);
            if (inst) await saveUndo(liveGql, inst, next);
          }
          await afterRun?.(summary, applied.current);
        },
      }),
    [bundles, redirect, kind], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const blocker = changes.length === 0 ? "There is nothing to save." : kind === "save" && edit.built.errors.length > 0 ? "Fix the problems in the editor first." : null;

  return (
    <RunFlow
      engine={engine}
      action={action}
      applyLabel={applyLabel ?? (kind === "undo" ? `Put back ${changes.length} change${changes.length === 1 ? "" : "s"}` : `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`)}
      blocker={blocker}
      onBack={() => onClose([], [])}
      onFinished={() => onClose([...new Set(applied.current.map((c) => c.productId))], applied.current.map((c) => c.id))}
      finishLabel={finishLabel ?? "Back to the editor"}
    >
      <ChangesReview
        changes={changes}
        warnings={warnings}
        heading={kind === "undo" ? "What Undo will put back" : "Review your changes"}
        intro={kind === "undo" ? "This puts every field back to what it was before the last save. Nothing has been written yet." : intro}
      />
      {hasHandle ? (
        <s-section heading="Changed addresses">
          <s-checkbox label="Redirect the old product address to the new one" checked={redirect || undefined} ref={onChecked(setRedirect)} />
        </s-section>
      ) : null}
      {kind === "undo" ? <s-banner tone="info">Fields that were changed in Shopify since the save are not put back: the check before writing stops the run and tells you which.</s-banner> : null}
      {extra}
    </RunFlow>
  );
}
