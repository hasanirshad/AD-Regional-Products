import { useState } from "preact/hooks";
import { Pending, ProfileBar, Strip } from "../../shared/healthView";
import { defineBlock, Muted, Pill } from "../../shared/index";
import type { ProfileId } from "../../shared/settings";
import { load, reportOf, summaryOf, type Data } from "./logic";

export function View({ data }: { data: Data }) {
  const [profile, setProfile] = useState<ProfileId | null>(null);
  const report = reportOf(data, profile);
  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        {report.score !== null ? <Pill tone={report.counts.blocks + report.counts.hurts === 0 ? "success" : report.counts.blocks > 0 ? "critical" : "warning"}>{report.score} / 100</Pill> : null}
        <s-text type="strong">{report.verdict}</s-text>
      </s-stack>
      <Strip report={report} />
      <ProfileBar report={report} onPick={setProfile} />
      <Pending report={report} />
      {data.notes.map((n) => (
        <Muted key={n}>{n}</Muted>
      ))}
      {report.notApplicable > 0 ? <Muted>{report.notApplicable} checks do not apply to this kind of product and are not shown.</Muted> : null}
    </s-stack>
  );
}

export default defineBlock<Data>({
  heading: "Product health",
  load,
  summary: (d) => summaryOf(reportOf(d)),
  View,
});
