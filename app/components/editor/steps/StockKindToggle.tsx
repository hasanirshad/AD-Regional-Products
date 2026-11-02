// "In stock" or "Made to order": the choice on the first step, repeated on the Inventory step. It sets how the variants'
// inventory is tracked and stocked (see inventoryPlan.ts), and can be changed again at any time.

import type { ProductDoc } from "../../../lib/editor/doc";
import { defaultLocation, modeOf, planStockMode } from "../../../lib/editor/inventoryPlan";
import { hasOnlyDefaultOption } from "../../../lib/editor/optionsPlan";
import { STOCK_KIND_LABEL, type StockKind } from "../../../lib/editor/productSteps";
import type { EditState } from "../../../views/edit-state";
import type { EditorShared } from "../../../views/editor-state";

/** The kind on screen: the one chosen, or what the product's variants are now. */
export function stockKindOf(edit: EditState, doc: ProductDoc): StockKind {
  const chosen = edit.stockKinds[doc.id];
  if (chosen) return chosen;
  return modeOf(doc.variants.map((v) => ({ tracked: edit.effectiveValue({ kind: "variant", productId: doc.id, variantId: v.id, field: "tracked" }) === "true" }))) === "stock" ? "stock" : "made_to_order";
}

/** Makes the variants follow the kind: tracking, and a quantity where there is none. Returns the notes to show. */
export function applyStockKind(edit: EditState, shared: EditorShared, doc: ProductDoc, kind: StockKind): string[] {
  const where = defaultLocation(shared.info.data?.locations ?? []);
  const plan = planStockMode(doc.id, doc.variants, kind, where?.id ?? null);
  for (const e of plan.edits) edit.put(e.target, e.value);
  return plan.notes;
}

export function StockKindToggle({ edit, shared, doc, applyNow }: { edit: EditState; shared: EditorShared; doc: ProductDoc; /** Change the variants now (they are made on the Inventory step when the product has no options yet). */ applyNow: boolean }) {
  const kind = stockKindOf(edit, doc);
  const mixed = modeOf(doc.variants) === "mixed" && !edit.stockKinds[doc.id];
  const choose = (next: StockKind) => {
    edit.setStockKind(doc.id, next);
    if (applyNow || !hasOnlyDefaultOption(doc.options)) applyStockKind(edit, shared, doc, next);
  };
  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200">
        {(Object.keys(STOCK_KIND_LABEL) as StockKind[]).map((k) => (
          <s-button key={k} variant={kind === k ? "primary" : "secondary"} onClick={() => choose(k)} accessibilityLabel={`${STOCK_KIND_LABEL[k]}${kind === k ? " (chosen)" : ""}`}>
            {STOCK_KIND_LABEL[k]}
          </s-button>
        ))}
      </s-stack>
      <s-text color="subdued">
        {kind === "stock"
          ? "Inventory is tracked. Each variant starts with a quantity of 1 where it has none. You can change the quantity for each variant on the Inventory step."
          : "Inventory is not tracked: the product can always be ordered. Each variant is stocked at the default location with no quantity."}
      </s-text>
      {mixed ? <s-text color="subdued">Some variants track inventory and some do not. Choosing one makes them all the same.</s-text> : null}
    </s-stack>
  );
}
