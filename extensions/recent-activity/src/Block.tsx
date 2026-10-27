import { defineBlock, formatDateTime, Muted, Table, timeAgo } from "../../shared/index";
import { load, type Data } from "./logic";

export function View({ data }: { data: Data }) {
  return (
    <s-stack direction="block" gap="base">
      <s-text>
        Last updated: <s-text type="strong">{formatDateTime(data.updatedAt)}</s-text> ({timeAgo(data.updatedAt)})
      </s-text>
      {data.events.length ? (
        <Table headers={["When", "What happened", "Who"]} rows={data.events.map((e) => ({ key: e.id, cells: [<span title={formatDateTime(e.when)}>{timeAgo(e.when)}</span>, e.text, e.who] }))} />
      ) : (
        <Muted>No events on the product timeline.</Muted>
      )}
      <Muted>
        Price changes are not listed: Shopify's product events do not include them, so nothing is guessed here. The API also gives the app name but never the staff member's name.
      </Muted>
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Recent activity",
  load,
  summary: (d) => `Updated ${d.updatedAt ? new Date(d.updatedAt).toLocaleDateString() : "—"}`,
  View,
});
