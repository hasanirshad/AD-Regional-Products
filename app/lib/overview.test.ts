import { describe, expect, it } from "vitest";
import { buildOverview, countryMatrix, coverage, focusOf, GENERAL, isPublishedIn, matchFocus, shipsTo } from "./overview";
import type { Group, Market, ProductRow, ProfileSummary } from "./types";

const profile = (id: string, countries: string[], extra: Partial<ProfileSummary> = {}): ProfileSummary => ({
  id,
  name: id,
  isDefault: false,
  variantCount: 0,
  locationGroupIds: [],
  zoneIds: [],
  countries,
  restOfWorld: false,
  rateCount: 2,
  zonesTruncated: false,
  ...extra,
});

const market = (id: string, codes: string[], catalogIds: string[], status = "ACTIVE"): Market => ({
  id,
  name: id,
  status,
  countries: codes.map((code) => ({ code, name: code })),
  catalogs: catalogIds.map((c) => ({ id: c, title: c })),
});

const product = (id: string, catalogIds: string[], status = "ACTIVE"): ProductRow => ({
  id,
  numericId: id,
  title: id,
  handle: id,
  vendor: "",
  productType: "",
  status,
  tags: [],
  catalogs: catalogIds.map((c) => ({ id: c, title: c })),
});

const general = profile("general", ["GB", "DE", "FR", "US"], { isDefault: true, restOfWorld: true });
const uk = profile("uk", ["GB"]);
const groups: Group[] = [{ id: "g-uk", name: "UK", countries: ["GB"], profileId: "uk" }];
const markets = [market("UK", ["GB"], ["c-uk"]), market("DE", ["DE"], ["c-de"]), market("CH", ["CH", "LI"], ["c-ch"])];

describe("shipsTo and coverage", () => {
  it("honours explicit countries and rest of world", () => {
    expect(shipsTo(uk, "gb")).toBe(true);
    expect(shipsTo(uk, "DE")).toBe(false);
    expect(shipsTo(general, "JP")).toBe(true);
    expect(shipsTo(null, "GB")).toBe(false);
  });
  it("classifies a market as all, mixed or none", () => {
    const ch = markets[2]!;
    expect(coverage(profile("x", ["CH", "LI"]), ch).state).toBe("all");
    expect(coverage(profile("x", ["CH"]), ch)).toMatchObject({ state: "mixed", blocked: ["LI"] });
    expect(coverage(uk, ch).state).toBe("none");
  });
  it("matches a product to a market through the market's own catalogues", () => {
    expect(isPublishedIn(product("p", ["c-uk"]), markets[0]!)).toBe(true);
    expect(isPublishedIn(product("p", ["c-uk"]), markets[1]!)).toBe(false);
  });
});

describe("buildOverview", () => {
  const rows = [
    product("a", ["c-uk"]), // UK group, published in UK: sellable
    product("b", ["c-de"]), // UK group, published in DE: blocked
    product("c", []), // General, no catalogue
    product("d", ["c-de", "c-ch"]), // General: DE sellable, CH sellable (rest of world)
    product("e", [], "DRAFT"), // draft: ignored in counts and issues
  ];
  const membership = { a: "g-uk", b: "g-uk" };
  const o = buildOverview({ markets, profiles: [general, uk], groups, rows, membership });

  it("counts totals over active products", () => {
    expect(o.totals).toMatchObject({ products: 5, active: 4, inGroups: 2, noCatalogue: 1, groups: 1, markets: 3 });
  });

  it("gives each product a state per market", () => {
    const line = (id: string) => o.lines.find((l) => l.product.id === id)!;
    expect(line("a").cells).toMatchObject({ UK: "sellable", DE: "unpublished", CH: "unpublished" });
    expect(line("b").cells.DE).toBe("blocked");
    expect(line("d").cells).toMatchObject({ DE: "sellable", CH: "sellable" });
    expect(line("b").hasProblem).toBe(true);
    expect(line("a").hasProblem).toBe(false);
  });

  it("summarises per market and per group", () => {
    const de = o.markets.find((m) => m.market.id === "DE")!;
    expect(de.counts).toMatchObject({ sellable: 1, blocked: 1 });
    const g = o.groups.find((x) => x.key === "g-uk")!;
    expect(g.products).toBe(2);
    expect(g.perMarket.find((p) => p.coverage.market.id === "DE")?.counts.blocked).toBe(1);
  });

  it("raises the right issues, most severe first", () => {
    const titles = o.issues.map((i) => i.title);
    expect(o.issues[0]?.level).toBe("critical");
    expect(titles.some((t) => /published in DE but cannot be bought/.test(t))).toBe(true);
    expect(titles.some((t) => /1 active product is in no catalogue/.test(t))).toBe(true);
  });

  it("counts products per catalogue and lists the markets using it", () => {
    const c = o.catalogs.find((x) => x.id === "c-de")!;
    expect(c).toMatchObject({ products: 2, markets: ["DE"] });
  });
});

describe("group issues", () => {
  const run = (g: Group[], profiles: ProfileSummary[]) =>
    buildOverview({ markets, profiles, groups: g, rows: [], membership: {} }).issues;

  it("flags no profile, a missing profile, no rates and a country mismatch", () => {
    expect(run([{ id: "g", name: "X", countries: ["GB"], profileId: null }], [general])[0]?.title).toMatch(/no shipping profile/);
    expect(run([{ id: "g", name: "X", countries: ["GB"], profileId: "gone" }], [general])[0]).toMatchObject({
      level: "critical",
    });
    const noRates = run([{ id: "g", name: "X", countries: ["GB"], profileId: "uk" }], [general, profile("uk", ["GB"], { rateCount: 0 })]);
    expect(noRates.some((i) => /no active shipping rates/.test(i.title))).toBe(true);
    const mismatch = run([{ id: "g", name: "X", countries: ["GB", "DE"], profileId: "uk" }], [general, uk]);
    expect(mismatch.some((i) => /different countries/.test(i.title))).toBe(true);
  });

  it("falls back to General for a group whose profile is gone", () => {
    const o = buildOverview({
      markets,
      profiles: [general],
      groups: [{ id: "g", name: "X", countries: [], profileId: "gone" }],
      rows: [product("a", ["c-uk"])],
      membership: { a: "g" },
    });
    expect(o.lines[0]?.groupKey).toBe(GENERAL);
  });
});

describe("countryMatrix", () => {
  it("lists each country once with the markets it belongs to and who ships there", () => {
    const o = buildOverview({ markets, profiles: [general, uk], groups, rows: [], membership: {} });
    const rows = countryMatrix([...markets, market("EU", ["DE"], [])], o.shippers);
    const de = rows.find((r) => r.code === "DE")!;
    expect(de.markets).toEqual(["DE", "EU"]);
    expect(de.ships).toEqual({ [GENERAL]: true, "g-uk": false });
    expect(rows.filter((r) => r.code === "DE")).toHaveLength(1);
  });
});

describe("matchFocus", () => {
  const rows = [
    product("a", ["c-uk"]),
    product("b", ["c-de"]),
    product("c", []),
    product("d", ["c-de", "c-ch"]),
    product("e", [], "DRAFT"),
  ];
  const o = buildOverview({ markets, profiles: [general, uk], groups, rows, membership: { a: "g-uk", b: "g-uk" } });
  const ids = (f: Partial<Parameters<typeof focusOf>[0]>) =>
    o.lines.filter((l) => matchFocus(l, focusOf(f))).map((l) => l.product.id);

  it("filters by group, market state and active status", () => {
    expect(ids({ groupKey: "g-uk" })).toEqual(["a", "b"]);
    expect(ids({ marketId: "DE", state: "blocked" })).toEqual(["b"]);
    expect(ids({ marketId: "DE", state: "sellable" })).toEqual(["d"]);
    expect(ids({ marketId: "DE", state: "published" })).toEqual(["b", "d"]);
    expect(ids({ activeOnly: true })).toEqual(["a", "b", "c", "d"]);
  });
  it("filters by catalogue, group membership and presets", () => {
    expect(ids({ catalogId: "c-de" })).toEqual(["b", "d"]);
    expect(ids({ inAnyGroup: true })).toEqual(["a", "b"]);
    expect(ids({ show: "nocat" })).toEqual(["c"]);
    expect(ids({ show: "problem" })).toEqual(["b"]);
    expect(ids({ show: "ok" })).toEqual(["a", "d"]);
  });
  it("every issue with a focus points at real products", () => {
    for (const i of o.issues) if (i.focus) expect(ids(i.focus).length).toBeGreaterThan(0);
  });
});
