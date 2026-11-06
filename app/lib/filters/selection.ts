// The ticked rows and "Show only selected". Pure.

/** The rows the table shows: with "Show only selected" on, the ticked rows (search and filters are ignored); else the filtered rows. */
export function visibleRows<T extends { id: string }>(all: readonly T[], filtered: readonly T[], selected: ReadonlySet<string>, onlySelected: boolean): T[] {
  return onlySelected ? all.filter((r) => selected.has(r.id)) : [...filtered];
}

/** Ticks every row that matches (and keeps the ones already ticked). Rows that do not match are not touched. */
export function selectMatching(selected: ReadonlySet<string>, matching: readonly { id: string }[]): Set<string> {
  const next = new Set(selected);
  for (const r of matching) next.add(r.id);
  return next;
}

/** How many of the matching rows are ticked: "Select all matching" counts only these. */
export const matchingSelected = (selected: ReadonlySet<string>, matching: readonly { id: string }[]): number => matching.reduce((n, r) => n + (selected.has(r.id) ? 1 : 0), 0);

/** The line shown while "Show only selected" is on. */
export const onlySelectedNote = (count: number, thing = "product"): string => `Showing the ${count} selected ${thing}${count === 1 ? "" : "s"} (filters are ignored)`;

/** Unticking "Show only selected" is automatic when nothing is ticked any more. */
export const onlySelectedStays = (selected: ReadonlySet<string>, onlySelected: boolean): boolean => onlySelected && selected.size > 0;
