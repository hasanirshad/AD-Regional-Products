import { describe, expect, it } from "vitest";
import { buildOverview, coverageParts, focusOf, matchFocus } from "./overview";
import { market, product, profile, zone } from "./testkit";
import type { Parts } from "./types";

const general = profile("general", [], { isDefault: true, restOfWorld: true });
const dhl = profile("dhl", ["DE"], { zones: [zone("z1", ["DE"], 1)] });
const uk = profile("uk", ["GB"], { zones: [zone("z2", ["GB"], 1)] });
const markets = [market("DE", ["DE"]), market("UK", ["GB"]), market("CH", ["CH", "LI"])];

describe("coverageParts", () => {
  it("needs EVERY part to ship to a country", () => {
    const cov = coverageParts([dhl, uk], markets[0]!);
    expect(cov.state).toBe("none");
    expect(cov.blocked).toEqual(["DE"]);
  });
  it("one part gives the plain coverage", () => {
    expect(coverageParts([dhl], markets[0]!).state).toBe("all");
  });
  it("is mixed when some countries are shipped by every part", () => {
    const a = profile("a", ["CH", "LI"]);
    const b = profile("b", ["CH"]);
    const cov = coverageParts([a, b], markets[2]!);
    expect(cov.state).toBe("mixed");
    expect(cov.ships).toEqual(["CH"]);
  });
});

describe("split products", () => {
  const rows = [
    product("whole", ["c-DE"], "ACTIVE", 2),
    product("split", ["c-DE", "c-UK"], "ACTIVE", 2),
  ];
  const parts: Parts = {
    whole: [{ key: "dhl", variants: 2 }],
    split: [{ key: "dhl", variants: 1 }, { key: "uk", variants: 1 }],
  };
  const o = buildOverview({ markets, profiles: [general, dhl, uk], rows, membership: { whole: "dhl", split: "dhl" }, parts });

  it("flags the split product and raises a warning with the unify fix", () => {
    const line = o.lines.find((l) => l.product.id === "split")!;
    expect(line.split).toBe(true);
    expect(line.parts.map((p) => p.name)).toEqual(["dhl", "uk"]);
    expect(o.totals.split).toBe(1);
    const issue = o.issues.find((i) => i.fix?.kind === "unify");
    expect(issue?.level).toBe("warning");
    expect(issue?.focus?.show).toBe("split");
  });
  it("judges it by its weakest profile: DE needs dhl AND uk", () => {
    const line = o.lines.find((l) => l.product.id === "split")!;
    expect(line.cells[markets[0]!.id]).toBe("blocked");
    expect(line.cells[markets[1]!.id]).toBe("blocked");
    expect(line.hasProblem).toBe(true);
  });
  it("keeps split products out of the profile counts and out of the blocked issue", () => {
    const row = o.profiles.find((p) => p.key === "dhl")!;
    expect(row.products).toBe(1);
    expect(row.splitProducts).toBe(1);
    expect(o.issues.some((i) => i.fix?.kind === "market")).toBe(false);
  });
  it("the profile filter finds a split product through any of its parts", () => {
    const line = o.lines.find((l) => l.product.id === "split")!;
    expect(matchFocus(line, focusOf({ profileKey: "uk" }))).toBe(true);
    expect(matchFocus(line, focusOf({ show: "split" }))).toBe(true);
    expect(matchFocus(o.lines.find((l) => l.product.id === "whole")!, focusOf({ show: "split" }))).toBe(false);
  });
});

describe("partial problems", () => {
  it("raises a warning with a countries-only fix and the missing countries", () => {
    const ch = market("CH", ["CH", "LI"]);
    const p = profile("ch", ["CH"], { zones: [zone("z", ["CH"], 1)] });
    const o = buildOverview({ markets: [ch], profiles: [general, p], rows: [product("a", ["c-CH"])], membership: { a: "ch" } });
    const issue = o.issues.find((i) => i.fix?.kind === "market" && i.fix.state === "partial");
    expect(issue?.level).toBe("warning");
    expect(issue?.detail).toContain("LI");
    expect(issue?.fix).toMatchObject({ kind: "market", actions: ["countries"] });
  });
  it("blocked problems offer both fixes", () => {
    const o = buildOverview({ markets: [markets[0]!], profiles: [general, uk], rows: [product("a", ["c-DE"])], membership: { a: "uk" } });
    const issue = o.issues.find((i) => i.fix?.kind === "market");
    expect(issue?.level).toBe("critical");
    expect(issue?.fix).toMatchObject({ state: "blocked", actions: ["unpublish", "countries"] });
  });
});

describe("zones without rates", () => {
  it("a zone that lists countries but has no rate is a critical problem, and those countries do not count as shipping", () => {
    const p = profile("p", ["DE"], {
      zones: [zone("z1", ["DE"], 1), zone("z2", ["FR"], 0, { name: "France" })],
      unratedCountries: ["FR"],
    });
    const o = buildOverview({ markets: [market("FR", ["FR"])], profiles: [general, p], rows: [product("a", ["c-FR"])], membership: { a: "p" } });
    const zoneIssue = o.issues.find((i) => i.title.includes('Zone "France"'));
    expect(zoneIssue?.level).toBe("critical");
    expect(o.lines[0]!.cells["FR"]).toBe("blocked");
  });
  it("says so when the rates could not be read", () => {
    const o = buildOverview({ markets, profiles: [general, profile("p", ["DE"], { ratesKnown: false })], rows: [], membership: {} });
    expect(o.issues.some((i) => i.title === "Shipping rates could not be read")).toBe(true);
  });
  it("shows the notes from the products load", () => {
    const o = buildOverview({ markets, profiles: [general], rows: [], membership: {}, notes: ["Only the first 10000 products were read."] });
    expect(o.issues.some((i) => i.title.startsWith("Only the first"))).toBe(true);
  });
});
