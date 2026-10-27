import { defineBlock, Muted, Pill, Table } from "../../shared/index";
import { load, type Check, type Data } from "./logic";

const RESULT: Record<Check["status"], { tone: "success" | "critical" | "neutral"; text: string }> = {
  pass: { tone: "success", text: "Pass" },
  fail: { tone: "critical", text: "Fail" },
  skipped: { tone: "neutral", text: "Not configured" },
};

export function View({ data }: { data: Data }) {
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="small" alignItems="center">
        <Pill tone={data.passed === data.counted ? "success" : "warning"}>
          {data.passed} of {data.counted} passed
        </Pill>
      </s-stack>
      <Table
        headers={["Check", "Result", "Why"]}
        rows={data.checks.map((c) => ({
          key: c.id,
          cells: [c.label, <Pill tone={RESULT[c.status].tone}>{RESULT[c.status].text}</Pill>, c.reason ? <s-text>{c.reason}</s-text> : <Muted>—</Muted>],
        }))}
      />
      {data.notes.map((n) => (
        <Muted key={n}>{n}</Muted>
      ))}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Data quality checklist",
  load,
  summary: (d) => `${d.passed} of ${d.counted} passed`,
  View,
});
