import { useMemo, useState } from "react";
import { CLEAR_WORD, parseTsv, planPaste, type Column, type PastePlan } from "../../lib/editor/bulk";
import type { ProductRow } from "../../lib/types";
import { Dialog } from "./Dialog";
import { TextBox } from "./TextBox";

/**
 * Paste a block copied from a spreadsheet. Row 1 holds the column names, the first column names the product (Handle, ID
 * or Title). Empty cells change nothing. The pasted values go into the table as ordinary edits: nothing is saved until
 * you review and confirm.
 */
export function PasteDialog({
  columns,
  products,
  tableText,
  onApply,
  onClose,
}: {
  columns: Column[];
  products: ProductRow[];
  /** The table as spreadsheet text, so it can be copied, edited elsewhere and pasted back. */
  tableText: () => string;
  onApply: (plan: PastePlan) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = useMemo(() => (text.trim() ? planPaste(parseTsv(text), columns, products) : null), [text, columns, products]);
  const productsHit = plan ? new Set(plan.edits.map((e) => e.productId)).size : 0;

  return (
    <Dialog
      heading="Paste from a spreadsheet"
      onClose={onClose}
      maxWidth={760}
      footer={
        <s-stack direction="inline" gap="small-200" justifyContent="end">
          <s-button onClick={onClose}>Cancel</s-button>
          <s-button
            variant="primary"
            disabled={!plan || Boolean(plan.problem) || plan.edits.length === 0 || busy || undefined}
            onClick={async () => {
              if (!plan) return;
              setBusy(true);
              setError("");
              try {
                await onApply(plan);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setBusy(false);
              }
            }}
          >
            {plan && plan.edits.length > 0 ? `Put ${plan.edits.length} cell${plan.edits.length === 1 ? "" : "s"} in the table` : "Put the cells in the table"}
          </s-button>
        </s-stack>
      }
    >
      <s-stack gap="base">
        <s-text color="subdued">
          {`Row 1: the column names, as they are in the table. First column: Handle, ID or Title, to find each product. An empty cell changes nothing; type ${CLEAR_WORD} to empty a value.`}
        </s-text>
        <div>
          <s-button onClick={() => setText(tableText())}>Fill with the table as it is now</s-button>
        </div>
        <TextBox label="Pasted cells" value={text} onChange={setText} multiline rows={10} placeholder="Handle	Title	Tags" />
        {plan?.problem ? <s-banner tone="critical">{plan.problem}</s-banner> : null}
        {plan && !plan.problem ? (
          <s-stack gap="small-200">
            <s-text>{`${plan.edits.length} cell${plan.edits.length === 1 ? "" : "s"} in ${productsHit} product${productsHit === 1 ? "" : "s"}, matched by ${plan.matchedBy}.`}</s-text>
            {plan.unknownColumns.length > 0 ? <s-text color="subdued">{`Left out, no such column in the table: ${plan.unknownColumns.join(", ")}. Add it with Choose columns.`}</s-text> : null}
            {plan.readOnlyColumns.length > 0 ? <s-text color="subdued">{`Left out, cannot be edited here: ${plan.readOnlyColumns.join(", ")}.`}</s-text> : null}
            {plan.unmatched.length > 0 ? <s-text tone="critical">{`No product found for: ${plan.unmatched.slice(0, 8).join(", ")}${plan.unmatched.length > 8 ? ` and ${plan.unmatched.length - 8} more` : ""}.`}</s-text> : null}
            {plan.ambiguous.length > 0 ? <s-text tone="critical">{`More than one product for: ${plan.ambiguous.slice(0, 8).join(", ")}. Use the handle instead.`}</s-text> : null}
          </s-stack>
        ) : null}
        {error ? <s-text tone="critical">{error}</s-text> : null}
      </s-stack>
    </Dialog>
  );
}
