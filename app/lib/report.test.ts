import { describe, expect, it } from "vitest";
import { csvCell, reportCsv, reportFileName, reportSummary, type ReportRow } from "./report";

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  productId: "gid://shopify/Product/1",
  title: "Oak, table",
  handle: "oak-table",
  before: "Profile: General; catalogues: UK",
  after: "Profile: DE-DHL; catalogues: DE",
  added: ["DE: DE"],
  removed: ["UK: UK"],
  status: "done",
  message: "",
  ...over,
});

describe("csvCell", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("plain")).toBe("plain");
  });
  it("defuses spreadsheet formulas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1")).toBe("'-1");
  });
});

describe("reportCsv", () => {
  const csv = reportCsv("Move to DE-DHL", [row(), row({ productId: "2", title: "Chair", status: "not verified", message: "still old" })], new Date("2026-10-25T10:00:00Z"));
  const lines = csv.trim().split("\r\n");
  it("has a header and one line per product, with before, after and status", () => {
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("time,action,product,handle,product_id,before,after,added,removed,status,message");
    expect(lines[1]).toContain('"Oak, table"');
    expect(lines[1]).toContain("2026-10-25T10:00:00.000Z");
    expect(lines[2]).toContain("not verified,still old");
  });
});

describe("summary and file name", () => {
  it("counts by status", () => {
    expect(reportSummary([row(), row({ status: "failed" }), row({ status: "failed" })])).toEqual({ done: 1, failed: 2, "not verified": 0, "not applied": 0 });
  });
  it("makes a safe file name", () => {
    expect(reportFileName("Move to DE-DHL!", new Date("2026-10-25T10:05:00Z"))).toBe("regional-products-move-to-de-dhl-2026-10-25-10-05.csv");
  });
});
