import { defineBlock, Muted, Pill, Table } from "../../shared/index";
import { load, type Data, type Fact } from "./logic";

const BAR = 10;
/** A small text bar: filled up to the limit. */
export const bar = (now: number, max: number): string => {
  const filled = Math.max(0, Math.min(BAR, Math.round((now / Math.max(1, max)) * BAR)));
  return "█".repeat(filled) + "░".repeat(BAR - filled);
};

const valueOf = (f: Fact) => (f.warn ? <Pill tone="warning">{f.value}</Pill> : <s-text>{f.value}</s-text>);

export function View({ data }: { data: Data }) {
  return (
    <s-stack direction="block" gap="base">
      <Table
        headers={["Fact", "Value", ""]}
        rows={data.facts.map((f) => ({
          key: f.key,
          cells: [f.label, valueOf(f), f.bar ? <s-text color="subdued">{bar(f.bar.now, f.bar.max)}{f.note ? ` ${f.note}` : ""}</s-text> : f.note ? <Muted>{f.note}</Muted> : <Muted>—</Muted>],
        }))}
      />
      {data.notes.map((n) => (
        <Muted key={n}>{n}</Muted>
      ))}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Content snapshot",
  load,
  summary: (d) => {
    const n = d.facts.filter((f) => f.warn).length;
    return n ? `${n} out of range` : "All in range";
  },
  View,
});
