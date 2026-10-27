// Translation statuses, shared by the Translation Status and Sale and Badge blocks.

import { normalizeText } from "./format";
import { Muted, Pill, type Tone } from "./ui";

export type Status = "translated" | "missing" | "same" | "none";
export type Cell = { status: Status; outdated: boolean; /** For grouped rows (option values): how many of each. */ counts: { translated: number; missing: number; same: number; total: number } | null };
export type Content = { key: string; value?: string | null }[];
export type Translations = { key: string; value?: string | null; outdated?: boolean }[];

export const NO_CELL: Cell = { status: "none", outdated: false, counts: null };

/** Status of one field in one language. No source text means there is nothing to translate. */
export function cellFor(content: Content, translations: Translations, key: string): Cell {
  const source = content.find((c) => c.key === key);
  if (!source || !normalizeText(source.value)) return NO_CELL;
  const t = translations.find((x) => x.key === key);
  if (!t || !normalizeText(t.value)) return { status: "missing", outdated: false, counts: null };
  if (normalizeText(t.value) === normalizeText(source.value)) return { status: "same", outdated: false, counts: null };
  return { status: "translated", outdated: !!t.outdated, counts: null };
}

/** One cell for several resources (all values of one option): the worst status wins. */
export function groupCell(cells: Cell[]): Cell {
  const real = cells.filter((c) => c.status !== "none");
  if (!real.length) return NO_CELL;
  const counts = {
    translated: real.filter((c) => c.status === "translated").length,
    missing: real.filter((c) => c.status === "missing").length,
    same: real.filter((c) => c.status === "same").length,
    total: real.length,
  };
  const status: Status = counts.missing ? "missing" : counts.same ? "same" : "translated";
  return { status, outdated: real.some((c) => c.outdated), counts };
}

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
