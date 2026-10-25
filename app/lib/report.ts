// The change report: what a run did, row by row, as a CSV the person can download.
// Nothing is stored by the app: the file only exists on the person's computer.

export type ReportStatus = "done" | "failed" | "not verified" | "not applied";

export type ReportRow = {
  productId: string;
  /** Product title, or another label for the item changed. */
  title: string;
  handle: string;
  before: string;
  after: string;
  added: string[];
  removed: string[];
  status: ReportStatus;
  message: string;
};

const COLUMNS = ["time", "action", "product", "handle", "product_id", "before", "after", "added", "removed", "status", "message"] as const;

/** Quotes a cell, and defuses spreadsheet formulas (=, +, -, @ at the start). */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function reportCsv(action: string, rows: ReportRow[], when: Date = new Date()): string {
  const time = when.toISOString();
  const lines = [COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [time, action, r.title, r.handle, r.productId, r.before, r.after, r.added.join(" | "), r.removed.join(" | "), r.status, r.message]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export function reportSummary(rows: ReportRow[]): Record<ReportStatus, number> {
  const out: Record<ReportStatus, number> = { done: 0, failed: 0, "not verified": 0, "not applied": 0 };
  for (const r of rows) out[r.status]++;
  return out;
}

export function reportFileName(action: string, when: Date = new Date()): string {
  const slug = action.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "run";
  return `regional-products-${slug}-${when.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
}

/** Hands the CSV to the browser as a download. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
