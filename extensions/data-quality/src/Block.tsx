import { useState } from "preact/hooks";
import { OpenLink, ProfileBar, SEVERITY_TONE } from "../../shared/healthView";
import { defineBlock, Muted, Pill, Section, Table } from "../../shared/index";
import { GROUP_LABEL, GROUPS, SEVERITY_LABEL, type ProfileId } from "../../shared/settings";
import type { CheckResult } from "../../shared/rules";
import { load, reportOf, type Data } from "./logic";

const RESULT: Record<"pass" | "fail" | "unknown", { tone: "success" | "critical" | "neutral"; text: string }> = {
  pass: { tone: "success", text: "Pass" },
  fail: { tone: "critical", text: "Fail" },
  unknown: { tone: "neutral", text: "Not read" },
};

const resultCell = (r: CheckResult) => {
  const look = RESULT[r.status as "pass" | "fail" | "unknown"];
  return <Pill tone={r.status === "fail" ? SEVERITY_TONE[r.severity] === "neutral" ? "caution" : SEVERITY_TONE[r.severity] : look.tone}>{look.text}</Pill>;
};

export function View({ data }: { data: Data }) {
  const [profile, setProfile] = useState<ProfileId | null>(null);
  const report = reportOf(data, profile);
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <Pill tone={report.passed === report.counted ? "success" : "warning"}>
          {report.passed} of {report.counted} passed
        </Pill>
        <Muted>Fail colours follow the severity: {Object.values(SEVERITY_LABEL).join(", ").toLowerCase()}.</Muted>
      </s-stack>
      <ProfileBar report={report} onPick={setProfile} />
      {GROUPS.map((g) => {
        const rows = report.shown.filter((r) => r.group === g);
        if (rows.length === 0) return null;
        return (
          <Section key={g} title={GROUP_LABEL[g]}>
            <Table
              headers={["Check", "Result", "Why"]}
              rows={rows.map((r) => ({
                key: r.id,
                cells: [
                  <s-stack direction="block" gap="small-300">
                    <s-text>{r.label}</s-text>
                    <Muted>{r.field}</Muted>
                  </s-stack>,
                  resultCell(r),
                  r.reason ? (
                    <s-stack direction="block" gap="small-300">
                      <s-text>{r.reason}</s-text>
                      <OpenLink r={r} />
                    </s-stack>
                  ) : (
                    <Muted>—</Muted>
                  ),
                ],
              }))}
            />
          </Section>
        );
      })}
      {data.notes.map((n) => (
        <Muted key={n}>{n}</Muted>
      ))}
      {report.notApplicable > 0 ? <Muted>{report.notApplicable} checks do not apply to this kind of product and are not shown.</Muted> : null}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Data quality checklist",
  load,
  summary: (d) => {
    const r = reportOf(d);
    return `${r.passed} of ${r.counted} passed`;
  },
  View,
});
