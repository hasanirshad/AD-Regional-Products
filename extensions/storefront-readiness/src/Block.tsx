import { defineBlock, ExternalLink, Muted, Pill, Table, type Tone } from "../../shared/index";
import { load, type DeliveryState, type Dot, type Data, type Piece } from "./logic";

const DOT: Record<Dot, { tone: Tone; text: string }> = {
  green: { tone: "success", text: "● Ready" },
  amber: { tone: "caution", text: "● Check" },
  red: { tone: "critical", text: "● Not ready" },
  grey: { tone: "neutral", text: "● No market" },
};

const PIECE: Record<Piece, { tone: Tone; text: string } | null> = {
  ok: { tone: "success", text: "Yes" },
  partial: { tone: "caution", text: "Partly" },
  missing: { tone: "critical", text: "No" },
  na: null,
  unknown: { tone: "neutral", text: "Not read" },
};

const DELIVERY: Record<DeliveryState, { tone: Tone; text: string } | null> = {
  found: { tone: "success", text: "Active" },
  draft: { tone: "caution", text: "Draft" },
  none: { tone: "critical", text: "Not found" },
  na: null,
  unknown: { tone: "neutral", text: "Not read" },
};

const cell = (look: { tone: Tone; text: string } | null, fallback = "—") => (look ? <Pill tone={look.tone}>{look.text}</Pill> : <Muted>{fallback}</Muted>);

export function View({ data }: { data: Data }) {
  const showDelivery = data.rows.some((r) => r.delivery !== "na");
  return (
    <s-stack direction="block" gap="base">
      <Table
        headers={["Market", "Ready", "Published", "Price", "Translated", ...(showDelivery ? ["Delivery time"] : []), "Preview"]}
        rows={data.rows.map((r) => ({
          key: r.state.def.key,
          cells: [
            <s-text type="strong">{r.state.def.key}</s-text>,
            <Pill tone={DOT[r.dot].tone}>{DOT[r.dot].text}</Pill>,
            r.state.state === "published" ? <Pill tone="success">Yes</Pill> : r.state.state === "not-published" ? <Pill tone="critical">No</Pill> : <Pill tone="neutral">No market</Pill>,
            cell(PIECE[r.price]),
            <s-stack direction="block" gap="small-300">
              {cell(PIECE[r.translation], r.state.def.locale ? "—" : "Main language")}
              {r.translationNote ? <Muted>{r.translationNote}</Muted> : null}
              {r.adaptation !== "na" ? <Muted>{r.adaptation === "present" ? "Market adaptation present" : r.adaptation === "absent" ? "Market adaptation missing" : "Adaptation not read"}</Muted> : null}
            </s-stack>,
            ...(showDelivery ? [cell(DELIVERY[r.delivery])] : []),
            <ExternalLink href={r.previewUrl}>Open</ExternalLink>,
          ],
        }))}
      />
      {data.notes.map((n) => (
        <Muted key={n}>{n}</Muted>
      ))}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Storefront readiness",
  load,
  summary: (d) => `${d.rows.filter((r) => r.dot === "green").length} of ${d.rows.length} ready`,
  View,
});
