import { describeTagChange } from "../../lib/editor/changes";
import { showValue } from "../../lib/editor/canon";
import { summarize } from "../../lib/editor/changes";
import { tabLabel, type Change, type Issue } from "../../lib/editor/model";

const SHOWN = 280;
const short = (s: string) => (s.length > SHOWN ? `${s.slice(0, SHOWN)}…` : s);

/** Every change, grouped by product, with the old and the new value. Nothing is written while this shows. */
const MAX_PRODUCTS = 40;

export function ChangesReview({ changes, warnings, heading = "What will change", intro }: { changes: Change[]; warnings: Issue[]; heading?: string; intro?: string }) {
  const sum = summarize(changes);
  const byProduct = new Map<string, Change[]>();
  for (const c of changes) {
    const list = byProduct.get(c.productId);
    if (list) list.push(c);
    else byProduct.set(c.productId, [c]);
  }
  return (
    <s-section heading={heading}>
      <s-stack gap="base">
        <s-text>{`${sum.total} change${sum.total === 1 ? "" : "s"} in ${sum.products} product${sum.products === 1 ? "" : "s"}. ${intro ?? "Nothing has been written yet."}`}</s-text>
        {warnings.length > 0 ? (
          <s-banner tone="warning" heading={warnings.length === 1 ? "One thing to look at" : `${warnings.length} things to look at`}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {warnings.slice(0, 8).map((w, i) => (
                <li key={`${w.id}-${i}`}>{w.message}</li>
              ))}
              {warnings.length > 8 ? <li>{`And ${warnings.length - 8} more.`}</li> : null}
            </ul>
          </s-banner>
        ) : null}
        {[...byProduct.entries()].slice(0, MAX_PRODUCTS).map(([id, list]) => (
          <s-stack key={id} gap="small-200">
            <s-text type="strong">{list[0]!.productTitle}</s-text>
            <s-table>
              <s-table-header-row>
                <s-table-header>Field</s-table-header>
                <s-table-header>Now</s-table-header>
                <s-table-header>After saving</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {list.map((c) => {
                  const tags = c.target.kind === "product" && c.target.field === "tags";
                  return (
                    <s-table-row key={c.id}>
                      <s-table-cell>
                        <s-stack gap="small-100">
                          <s-text>{c.label}</s-text>
                          <s-text color="subdued">{tabLabel(c.tab)}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{tags ? (c.before ? short(showValue(c.target, c.before)) : "—") : short(showValue(c.target, c.before))}</s-table-cell>
                      <s-table-cell>{tags ? describeTagChange(c.before, c.after) : short(showValue(c.target, c.after))}</s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </s-stack>
        ))}
        {byProduct.size > MAX_PRODUCTS ? <s-text color="subdued">{`And ${byProduct.size - MAX_PRODUCTS} more products. Every one of them is saved; the report lists each change.`}</s-text> : null}
      </s-stack>
    </s-section>
  );
}
