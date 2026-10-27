import type { EditorShared } from "../../views/editor-state";

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** The last save from either editor page can be put back. The record is kept in Shopify, so it survives a reload. */
export function UndoBar({ shared, onUndo }: { shared: EditorShared; onUndo: () => void }) {
  const u = shared.undo;
  if (!u) return null;
  const products = new Set(u.items.map((i) => i.productId)).size;
  return (
    <s-banner tone="info" heading="Last save can be undone">
      <s-paragraph>{`${u.action} · ${u.items.length} change${u.items.length === 1 ? "" : "s"} in ${products} product${products === 1 ? "" : "s"}${when(u.at) ? ` · ${when(u.at)}` : ""}.`}</s-paragraph>
      <s-button slot="secondary-actions" onClick={onUndo}>
        Review Undo
      </s-button>
    </s-banner>
  );
}
