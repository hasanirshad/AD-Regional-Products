import { defineBlock, formatRange, Muted, Note, Pill, Table, plural, type Tone } from "../../shared/index";
import { load, type Data, type MarketRow } from "./logic";

const STATE: Record<MarketRow["state"], { tone: Tone; text: string }> = {
  published: { tone: "success", text: "Published" },
  "not-published": { tone: "critical", text: "Not published" },
  "no-market": { tone: "warning", text: "Market not found" },
};

export function View({ data }: { data: Data }) {
  const missing = data.rows.filter((r) => r.state !== "published");
  const notLive = data.productStatus && data.productStatus !== "ACTIVE";
  const showShipping = data.rows.some((r) => r.shipping != null);
  const showReturns = data.rows.some((r) => r.returns != null);
  return (
    <s-stack direction="block" gap="base">
      {notLive ? (
        <Note tone="warning" heading={`Product is ${data.productStatus.toLowerCase()}`}>
          A product that is not active cannot be bought in any market.
        </Note>
      ) : null}
      {missing.length ? (
        <Note tone="warning" heading={`Not published in ${missing.map((r) => r.def.key).join(", ")}`}>
          {missing.some((r) => r.state === "no-market")
            ? "A market could not be matched to its country. Check the markets list on the Settings page of the app."
            : "These markets do not show this product."}
        </Note>
      ) : null}
      <Table
        headers={["Market", "Status", "Price", "Compare-at", ...(showShipping ? ["Shipping"] : []), ...(showReturns ? ["Returns"] : [])]}
        rows={data.rows.map((r) => {
          const s = STATE[r.state];
          return {
            key: r.def.key,
            cells: [
              <s-text type="strong">{r.def.key}</s-text>,
              <s-stack direction="inline" gap="small-300" alignItems="center">
                <Pill tone={s.tone}>{s.text}</Pill>
                {r.marketStatus && r.marketStatus !== "ACTIVE" ? <Pill tone="caution">Market {r.marketStatus.toLowerCase()}</Pill> : null}
              </s-stack>,
              r.price ? formatRange(r.price.low.price, r.price.high.price) : <Muted>No price</Muted>,
              r.price && (r.price.low.compareAt || r.price.high.compareAt) ? formatRange(r.price.low.compareAt, r.price.high.compareAt) : <Muted>—</Muted>,
              ...(showShipping ? [r.shipping ?? <Muted>—</Muted>] : []),
              ...(showReturns ? [r.returns ?? <Muted>—</Muted>] : []),
            ],
          };
        })}
      />
      {data.note ? <Muted>{data.note}</Muted> : null}
      {data.extrasNote ? <Muted>{data.extrasNote}</Muted> : null}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Market availability",
  load,
  summary: (d) => `${d.rows.filter((r) => r.state === "published").length} of ${plural(d.rows.length, "market")}`,
  View,
});
