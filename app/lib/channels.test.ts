import { describe, expect, it } from "vitest";
import { buildTargets, labelsIn, planPublish, type Target } from "./channels";
import type { PublicationState } from "./readback";
import { market, product, profile, zone } from "./testkit";

const de = market("DE", ["DE"]);
const uk = market("UK", ["GB"]);
const globalMarket = { ...market("GLOBAL", [], ["c-GLOBAL"]), name: "Global" };
const noPub = { ...market("NOPUB", ["FR"], ["c-NOPUB"]), catalogs: [{ id: "c-NOPUB", title: "No pub", publicationId: null }] };

const { targets, unavailable } = buildTargets({
  channels: [{ id: "pub-online", name: "Online Store" }, { id: "pub-pos", name: "Point of Sale" }],
  markets: [de, uk, noPub],
  hiddenMarkets: [globalMarket],
});
const byLabel = (l: string) => targets.find((t) => t.label === l)!;

const state = (id: string, publicationIds: string[], status = "ACTIVE", complete = true): PublicationState => ({ id, status, publicationIds, complete });
const base = { targets, markets: [de, uk], profiles: [profile("general", ["DE", "GB"], { isDefault: true })], membership: {} };

describe("buildTargets", () => {
  it("lists channels, then the catalogues of every market, including the hidden Global market", () => {
    expect(targets.map((t) => t.label)).toEqual(["Online Store", "Point of Sale", "c-DE", "c-UK", "c-GLOBAL"]);
    expect(byLabel("c-GLOBAL")).toMatchObject({ kind: "catalog", group: "Global (market)", id: "pub-c-GLOBAL" });
    expect(byLabel("Online Store").kind).toBe("channel");
  });
  it("reports catalogues that have no publication instead of offering them", () => {
    expect(unavailable).toEqual([{ label: "No pub", group: "NOPUB" }]);
  });
});

describe("planPublish", () => {
  const a = product("a");
  const b = product("b");
  const states = { a: state("a", ["pub-online"]), b: state("b", ["pub-online", "pub-pos", "pub-c-DE"]) };

  it("only plans what differs", () => {
    const plan = planPublish({ ...base, products: [a, b], states, choice: { "pub-pos": "publish", "pub-c-DE": "publish" } });
    expect(plan.lines.map((l) => [l.product.id, l.changes.map((c) => c.target.label)])).toEqual([["a", ["Point of Sale", "c-DE"]]]);
    expect(plan.unchanged.map((p) => p.id)).toEqual(["b"]);
    expect(plan.totals).toEqual({ publish: 2, unpublish: 0 });
    expect(plan.blocker).toBeNull();
  });
  it("can disable a channel and remove a catalogue", () => {
    const plan = planPublish({ ...base, products: [b], states, choice: { "pub-pos": "unpublish", "pub-c-DE": "unpublish" } });
    expect(plan.totals).toEqual({ publish: 0, unpublish: 2 });
  });
  it("works with the Global catalogue", () => {
    const plan = planPublish({ ...base, products: [a], states, choice: { "pub-c-GLOBAL": "publish" } });
    expect(plan.lines[0]!.changes[0]!.target.label).toBe("c-GLOBAL");
  });
  it("leaves out products that are not active, missing, or published to too many places", () => {
    const plan = planPublish({
      ...base,
      products: [a, b, product("c"), product("d")],
      states: { a: state("a", [], "DRAFT"), b: state("b", [], "ACTIVE", false), c: state("c", []) },
      choice: { "pub-pos": "publish" },
    });
    expect(plan.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/Not active/), expect.stringMatching(/too many/), "Not found. It may have been deleted."].map((x) => x));
    expect(plan.lines.map((l) => l.product.id)).toEqual(["c"]);
    expect(plan.warnings.join(" ")).toMatch(/not active and left out/);
  });
  it("has a blocker when nothing is chosen, nothing is selected, or nothing would change", () => {
    expect(planPublish({ ...base, products: [a], states, choice: {} }).blocker).toMatch(/Choose at least one/);
    expect(planPublish({ ...base, products: [], states, choice: { "pub-pos": "publish" } }).blocker).toMatch(/No products/);
    expect(planPublish({ ...base, products: [a], states, choice: { "pub-online": "publish" } }).blocker).toMatch(/Nothing would change/);
  });
  it("warns before removing products from the Online Store", () => {
    const plan = planPublish({ ...base, products: [a], states, choice: { "pub-online": "unpublish" } });
    expect(plan.warnings.join(" ")).toMatch(/removed from Online Store/);
  });
  it("warns when a product would be visible in a market where it cannot check out", () => {
    const ukOnly = profile("general", ["GB"], { isDefault: true, zones: [zone("z", ["GB"], 1)] });
    const plan = planPublish({ ...base, profiles: [ukOnly], products: [a], states, choice: { "pub-c-DE": "publish", "pub-c-UK": "publish" } });
    const text = plan.warnings.join(" ");
    expect(text).toMatch(/visible in DE but customers there cannot check out/);
    expect(text).not.toMatch(/visible in UK/);
  });
});

describe("labelsIn", () => {
  it("names the targets a product is in", () => {
    expect(labelsIn(["pub-pos", "pub-other", "pub-c-DE"], targets as Target[])).toEqual(["Point of Sale", "c-DE"]);
  });
});
