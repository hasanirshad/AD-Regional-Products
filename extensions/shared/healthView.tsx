// Pieces of view shared by Product health and Data quality. Read only: links open the field in the admin.

import { useState } from "preact/hooks";
import { Muted, Pill, type Tone } from "./ui";
import { PROFILE_LABEL, PROFILES, SEVERITIES, SEVERITY_LABEL, type ProfileId, type Severity } from "./healthSettings";
import type { CheckResult, HealthReport } from "./rules";

export const SEVERITY_TONE: Record<Severity, Tone> = { blocks: "critical", hurts: "warning", nice: "neutral" };

/** The kind of product, with the reason for the guess and a one-click way to judge it as another kind (nothing is saved). */
export function ProfileBar({ report, onPick }: { report: HealthReport; onPick: (p: ProfileId | null) => void }) {
  const changed = report.profile !== report.guess.profile;
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <Pill tone="info">{PROFILE_LABEL[report.profile]}</Pill>
        <Muted>{changed ? `Judged as ${PROFILE_LABEL[report.profile].toLowerCase()} for this view only.` : report.guess.reason}</Muted>
      </s-stack>
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <Muted>Judge as:</Muted>
        {PROFILES.map((p) => (
          <s-button key={p} variant={p === report.profile ? "secondary" : "tertiary"} onClick={() => onPick(p === report.guess.profile ? null : p)}>
            {PROFILE_LABEL[p]}
          </s-button>
        ))}
      </s-stack>
    </s-stack>
  );
}

/** Counts per severity, as a strip of three pills. */
export function Strip({ report }: { report: HealthReport }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      {SEVERITIES.map((sev) => (
        <Pill key={sev} tone={report.counts[sev] > 0 ? SEVERITY_TONE[sev] : "success"}>
          {SEVERITY_LABEL[sev]}: {report.counts[sev]}
        </Pill>
      ))}
    </s-stack>
  );
}

export function OpenLink({ r }: { r: CheckResult }) {
  return r.link ? (
    <s-link href={r.link.href} target="_blank">
      {r.link.label}
    </s-link>
  ) : null;
}

/** One pending item: what, which field, why, and where to fix it. */
export function PendingRow({ r }: { r: CheckResult }) {
  return (
    <s-stack direction="block" gap="small-300">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-text type="strong">{r.label}</s-text>
        <Pill tone="neutral">{r.field}</Pill>
      </s-stack>
      {r.reason ? <s-text>{r.reason}</s-text> : null}
      {r.items.length > 0 && r.items.join(", ") !== r.reason ? <Muted>{r.items.join(", ")}</Muted> : null}
      <OpenLink r={r} />
    </s-stack>
  );
}

/** The pending list grouped by severity. Collapsed to the top `limit` rows until "Show all". */
export function Pending({ report, limit = 5 }: { report: HealthReport; limit?: number }) {
  const [all, setAll] = useState(false);
  const rows = SEVERITIES.flatMap((sev) => report.pending[sev].map((r) => ({ sev, r })));
  if (rows.length === 0) return <s-text color="subdued">Nothing is pending.</s-text>;
  const visible = all ? rows : rows.slice(0, limit);
  return (
    <s-stack direction="block" gap="base">
      {SEVERITIES.map((sev) => {
        const list = visible.filter((x) => x.sev === sev);
        if (list.length === 0) return null;
        return (
          <s-stack key={sev} direction="block" gap="small-200">
            <s-heading>{SEVERITY_LABEL[sev]}</s-heading>
            {list.map(({ r }) => (
              <PendingRow key={r.id} r={r} />
            ))}
          </s-stack>
        );
      })}
      {rows.length > limit ? (
        <s-button variant="tertiary" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </s-button>
      ) : null}
    </s-stack>
  );
}
