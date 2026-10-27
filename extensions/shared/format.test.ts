import { describe, expect, it } from "vitest";
import { discountPercent, formatMoney, formatPercentRange, formatRange, hasEdgeSpace, normalizeText, parseMoney, plainText, plural, shortList, timeAgo } from "./format";

describe("money", () => {
  it("parses and formats", () => {
    const m = parseMoney({ amount: "1200.0", currencyCode: "GBP" });
    expect(m).toEqual({ amount: 1200, currency: "GBP" });
    expect(formatMoney(m)).toMatch(/1,?200/);
    expect(formatMoney(null)).toBe("—");
    expect(parseMoney({ amount: "abc", currencyCode: "GBP" })).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });

  it("shows one price or a range", () => {
    const a = { amount: 100, currency: "EUR" };
    const b = { amount: 250, currency: "EUR" };
    expect(formatRange(a, a)).toBe(formatMoney(a));
    expect(formatRange(a, b)).toContain("–");
    expect(formatRange(null, null)).toBe("—");
  });

  it("calculates the discount only for a real sale", () => {
    const price = { amount: 80, currency: "EUR" };
    expect(discountPercent(price, { amount: 100, currency: "EUR" })).toBe(20);
    expect(discountPercent(price, { amount: 80, currency: "EUR" })).toBeNull();
    expect(discountPercent(price, { amount: 50, currency: "EUR" })).toBeNull();
    expect(discountPercent(price, null)).toBeNull();
    expect(formatPercentRange([15, 25])).toBe("15–25%");
    expect(formatPercentRange([20, 20])).toBe("20%");
    expect(formatPercentRange([null, null])).toBe("—");
  });
});

describe("text", () => {
  it("compares text without spacing noise", () => {
    expect(normalizeText("  Oak   table ")).toBe("Oak table");
    expect(normalizeText(null)).toBe("");
    expect(hasEdgeSpace(" Oak")).toBe(true);
    expect(hasEdgeSpace("Oak")).toBe(false);
    expect(hasEdgeSpace("")).toBe(false);
  });

  it("strips html and entities from event messages", () => {
    expect(plainText('<a href="/x">Hardman</a> published &amp; updated &quot;Oak&quot;')).toBe('Hardman published & updated "Oak"');
    expect(plainText(null)).toBe("");
  });

  it("plural and lists", () => {
    expect(plural(1, "variant")).toBe("1 variant");
    expect(plural(3, "variant")).toBe("3 variants");
    expect(shortList(["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more");
  });

  it("says how long ago", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(timeAgo("2026-10-27T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-10-27T11:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-10-27T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-10-24T12:00:00Z", now)).toBe("3 days ago");
    expect(timeAgo(null, now)).toBe("—");
  });
});
