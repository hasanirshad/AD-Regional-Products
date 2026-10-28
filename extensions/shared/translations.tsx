import { Muted, Pill, type Tone } from "./ui";
import type { Cell, Status } from "./translationCells";

export * from "./translationCells";

const LOOK: Record<Exclude<Status, "none">, { tone: Tone; text: string }> = {
  translated: { tone: "success", text: "Translated" },
  missing: { tone: "critical", text: "Missing" },
  same: { tone: "caution", text: "Same as source" },
};

export function TranslationPill({ cell }: { cell: Cell }) {
  if (cell.status === "none") return <Muted>—</Muted>;
  const look = LOOK[cell.status];
  const outdated = cell.outdated && cell.status === "translated";
  const counts = cell.counts && cell.counts.total > 1 ? ` ${cell.counts[cell.status]}/${cell.counts.total}` : "";
  return (
    <Pill tone={outdated ? "info" : look.tone}>
      {look.text}
      {counts}
      {outdated ? " (outdated)" : ""}
    </Pill>
  );
}
