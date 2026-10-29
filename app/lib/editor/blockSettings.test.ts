import { describe, expect, it } from "vitest";
import { defaultSettings, parseSettings, serializeSettings, type BlockSettings } from "../../../extensions/shared/settings";
import { diffSettings, problemTab, resetTab, saveBlockSettings, SETTINGS_TABS, tabIsDefault, type TabId } from "./blockSettings";
import type { Gql } from "./gql";
import { isMutation, isUnlocked, runUnlocked } from "../guard";

const make = (change: (s: BlockSettings) => void) => {
  const s = structuredClone(defaultSettings());
  change(s);
  return s;
};

/** A store with one metafield. Like the live client, it refuses a mutation outside the password guard. */
function fakeStore(initial: string | null, opts: { userErrors?: string; keepOld?: boolean } = {}) {
  const state = { raw: initial, sets: 0, reads: 0 };
  const gql: Gql = async <T,>(query: string, vars: Record<string, unknown> = {}) => {
    if (isMutation(query) && !isUnlocked()) throw new Error("This change needs the password. Nothing was changed.");
    if (/mutation/.test(query)) {
      state.sets++;
      if (opts.userErrors) return { metafieldsSet: { userErrors: [{ message: opts.userErrors }] } } as T;
      const m = (vars.metafields as { namespace: string; key: string; type: string; value: string; ownerId: string }[])[0]!;
      expect(m).toMatchObject({ namespace: "$app", key: "block_settings", type: "json", ownerId: "gid://shopify/AppInstallation/1" });
      if (!opts.keepOld) state.raw = m.value;
      return { metafieldsSet: { userErrors: [] } } as T;
    }
    state.reads++;
    return { currentAppInstallation: { id: "gid://shopify/AppInstallation/1", blocks: state.raw === null ? null : { value: state.raw } } } as T;
  };
  return { gql, state };
}

describe("tabs and problems", () => {
  it("every problem path belongs to a tab", () => {
    expect(problemTab("languages.0.code")).toBe("translation");
    expect(problemTab("translation.rows.2")).toBe("translation");
    expect(problemTab("quality.checks.1.field")).toBe("quality");
    expect(problemTab("markets.0.domain")).toBe("links");
    expect(problemTab("markets.0.country")).toBe("markets");
    expect(problemTab("links.previewThemeId")).toBe("links");
    expect(problemTab("sale.badgeKey")).toBe("sale");
    expect(problemTab("adaptations.0.marketId")).toBe("adaptations");
  });
  it("there is a tab for each block and one for adaptations", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual(["translation", "groups", "thresholds", "themeFields", "helpers", "records", "quality", "links", "markets", "sale", "collections", "activity", "adaptations"]);
  });
});

describe("reset to defaults, per tab", () => {
  it("resets only its own tab", () => {
    const changed = make((s) => {
      s.activity.eventsLimit = 5;
      s.sale.collectionHandle = "clearance";
      s.languages.pop();
    });
    const reset = resetTab(changed, "activity");
    expect(reset.activity.eventsLimit).toBe(20);
    expect(reset.sale.collectionHandle).toBe("clearance");
    expect(reset.languages).toHaveLength(2);
  });
  it("every tab can be reset to exactly the defaults", () => {
    for (const t of SETTINGS_TABS) {
      const messy = make((s) => {
        s.languages = [{ code: "es", label: "Spanish" }];
        s.translation.rows = [{ type: "core", field: "title" }];
        s.quality.checks = [];
        s.quality.fields.leadTime = [{ label: "Lead", namespace: "custom", key: "lead_time", owner: "product" }];
        s.links = { previewThemeId: "123456789", previewMarket: "FR" };
        s.sale = { badgeNamespace: "x_y_z", badgeKey: "k1", collectionHandle: "other" };
        s.collections = { showTags: false, showType: false };
        s.activity.eventsLimit = 3;
        s.adaptations = [{ locale: "en", marketId: "gid://shopify/Market/1", marketName: "US" }];
        s.markets = s.markets.slice(0, 2);
      });
      const out = resetTab(messy, t.id as TabId);
      expect(tabIsDefault(out, t.id)).toBe(true);
    }
  });
  it("resetting the domains keeps the other market settings; resetting markets keeps the chosen domains", () => {
    const changed = make((s) => {
      s.markets[0]!.domain = "custom.example.fr";
      s.markets[0]!.enabled = false;
    });
    const a = resetTab(changed, "links");
    expect(a.markets[0]).toMatchObject({ domain: "hardmandesign.fr", enabled: false });
    const b = resetTab(changed, "markets");
    expect(b.markets[0]).toMatchObject({ domain: "custom.example.fr", enabled: true });
  });
  it("the defaults are already default", () => {
    for (const t of SETTINGS_TABS) expect(tabIsDefault(defaultSettings(), t.id)).toBe(true);
  });
});

describe("diffSettings: the review lists every change in words", () => {
  it("nothing changed means no lines", () => {
    expect(diffSettings(defaultSettings(), defaultSettings())).toEqual([]);
  });
  it("describes each kind of change", () => {
    const after = make((s) => {
      s.languages.push({ code: "es", label: "Spanish" });
      s.translation.rows.reverse();
      s.quality.checks.find((c) => c.id === "seo")!.on = false;
      s.quality.checks.push({ id: "mf:product:custom.care", kind: "metafield", label: "Care text", on: true, field: { label: "Care", namespace: "custom", key: "care", owner: "product" } });
      s.quality.fields.leadTime = [{ label: "Lead time", namespace: "custom", key: "lead_time", owner: "product" }];
      s.links.previewThemeId = "123456789";
      s.markets[0]!.domain = "shop.example.fr";
      s.markets[1]!.enabled = false;
      s.sale.badgeKey = "ribbon";
      s.collections.showTags = false;
      s.activity.eventsLimit = 8;
      s.adaptations = [{ locale: "en", marketId: "gid://shopify/Market/1", marketName: "United States" }];
    });
    const lines = diffSettings(defaultSettings(), after);
    const text = lines.map((l) => `${l.tab}|${l.label}|${l.from}|${l.to}`).join("\n");
    expect(text).toContain("translation|Languages|French (fr), German (de), Dutch (nl)|French (fr), German (de), Dutch (nl), Spanish (es)");
    expect(text).toContain("translation|Rows, in order");
    expect(text).toContain("quality|Check: SEO title and description|on|off");
    expect(text).toContain("quality|Check: Care text|not in the list|added, on, custom.care (product)");
    expect(text).toContain("quality|Lead-time metafields|none|custom.lead_time (product)");
    expect(text).toContain("links|Preview theme id|(empty)|123456789");
    expect(text).toContain("links|FR storefront domain|hardmandesign.fr|shop.example.fr");
    expect(text).toContain("markets|DE shown in the blocks|on|off");
    expect(text).toContain("sale|Badge metafield|custom.sale_badge|custom.ribbon");
    expect(text).toContain("collections|Show tags|on|off");
    expect(text).toContain("activity|Events listed|20|8");
    expect(text).toContain("adaptations|Adaptation|not available|en for United States added");
  });
  it("says that removing an adaptation keeps the saved texts", () => {
    const before = make((s) => (s.adaptations = [{ locale: "en", marketId: "gid://shopify/Market/1", marketName: "United States" }]));
    const lines = diffSettings(before, defaultSettings());
    expect(lines[0]!.to).toContain("stay");
  });
});

describe("saveBlockSettings: the password gate, the recheck and the read-back", () => {
  const next = make((s) => (s.activity.eventsLimit = 9));
  const input = (raw: string | null) => ({ installationId: "gid://shopify/AppInstallation/1", expectedRaw: raw, next });

  it("refuses to write outside the password guard", async () => {
    const { gql, state } = fakeStore(null);
    await expect(saveBlockSettings(gql, input(null))).rejects.toThrow("needs the password");
    expect(state.sets).toBe(0);
    expect(state.raw).toBeNull();
  });

  it("saves inside the guard, and the value read back is the one sent", async () => {
    const { gql, state } = fakeStore(null);
    const out = await runUnlocked(() => saveBlockSettings(gql, input(null)));
    expect(parseSettings(state.raw).settings.activity.eventsLimit).toBe(9);
    expect(out.raw).toBe(state.raw);
    expect(state.sets).toBe(1);
  });

  it("stops when someone else saved in the meantime", async () => {
    const theirs = serializeSettings(make((s) => (s.activity.eventsLimit = 3)));
    const { gql, state } = fakeStore(theirs);
    await expect(runUnlocked(() => saveBlockSettings(gql, input(null)))).rejects.toThrow("Someone saved these settings");
    expect(state.sets).toBe(0);
    expect(state.raw).toBe(theirs);
  });

  it("refuses values that break the rules, even if the page let them through", async () => {
    const { gql, state } = fakeStore(null);
    const bad = make((s) => (s.activity.eventsLimit = 500));
    await expect(runUnlocked(() => saveBlockSettings(gql, { installationId: "gid://shopify/AppInstallation/1", expectedRaw: null, next: bad }))).rejects.toThrow("Nothing was saved");
    expect(state.sets).toBe(0);
  });

  it("shows Shopify's message when it refuses", async () => {
    const { gql } = fakeStore(null, { userErrors: "Value is invalid" });
    await expect(runUnlocked(() => saveBlockSettings(gql, input(null)))).rejects.toThrow("Shopify did not save the settings: Value is invalid");
  });

  it("notices when the read-back is not what was sent", async () => {
    const { gql } = fakeStore(null, { keepOld: true });
    await expect(runUnlocked(() => saveBlockSettings(gql, input(null)))).rejects.toThrow("do not match");
  });
});

describe("the health tabs", () => {
  it("problems at the new paths land on their tab", () => {
    expect(problemTab("groups.disabledRules")).toBe("groups");
    expect(problemTab("thresholds.seoTitleMax")).toBe("thresholds");
    expect(problemTab("themeFields.2.key")).toBe("themeFields");
    expect(problemTab("helpers.types.0")).toBe("helpers");
    expect(problemTab("records.swatchType")).toBe("records");
    expect(problemTab("markets.1.locale")).toBe("markets");
  });
  it("each new tab resets only itself", () => {
    const changed = make((s) => {
      s.groups.groups.seo = false;
      s.thresholds.minImages = 4;
      s.themeFields.pop();
      s.helpers.types = ["x"];
      s.records.designType = "";
    });
    expect(resetTab(changed, "groups").groups).toEqual(defaultSettings().groups);
    expect(resetTab(changed, "groups").thresholds.minImages).toBe(4);
    expect(resetTab(changed, "thresholds").thresholds.minImages).toBe(1);
    expect(resetTab(changed, "themeFields").themeFields).toHaveLength(defaultSettings().themeFields.length);
    expect(resetTab(changed, "helpers").helpers.types).toEqual(defaultSettings().helpers.types);
    expect(resetTab(changed, "records").records.designType).toBe("design_customisation");
    expect(tabIsDefault(changed, "records")).toBe(false);
    expect(tabIsDefault(resetTab(changed, "records"), "records")).toBe(true);
  });
  it("the review says in words what changed in groups, thresholds, theme fields, helpers and records", () => {
    const after = make((s) => {
      s.groups.groups.seo = false;
      s.groups.profiles.option.images = true;
      s.groups.disabledRules = ["variants.sku"];
      s.thresholds.seoTitleMax = 70;
      s.thresholds.weights.nice = 0;
      s.themeFields[0]!.on = false;
      s.themeFields.pop();
      s.helpers.expectedCategories = ["Tables", "Chairs"];
      s.records.deliveryType = "";
      s.markets[4]!.locale = "fr";
    });
    const lines = diffSettings(defaultSettings(), after);
    const text = lines.map((l) => `${l.tab}|${l.label}|${l.from}|${l.to}`);
    expect(text).toContain("groups|SEO group|on|off");
    expect(text).toContain("groups|Images for option product|off|on");
    expect(text).toContain("groups|Single check: SKU is filled|on|off");
    expect(text).toContain("thresholds|SEO title, longest|60|70");
    expect(text).toContain("thresholds|Score weight: Nice to have|1|0");
    expect(text.some((t) => t.startsWith("themeFields|Theme field: Tag line|on,"))).toBe(true);
    expect(text.some((t) => t.startsWith("themeFields|Theme field: SEO hidden flag|") && t.endsWith("|removed"))).toBe(true);
    expect(text).toContain("helpers|Expected product Types|none|Tables, Chairs");
    expect(text).toContain("records|Delivery-time record type|build_and_delivery_time|(empty)");
    expect(text).toContain("markets|UK language|(empty)|fr");
    expect(diffSettings(defaultSettings(), defaultSettings())).toEqual([]);
  });
  it("new settings go through the guarded save and come back the same", async () => {
    const store = fakeStore(null);
    const next = make((s) => {
      s.groups.groups.seo = false;
      s.thresholds.minImages = 3;
      s.helpers.tags = ["helper"];
    });
    await runUnlocked(() => saveBlockSettings(store.gql, { installationId: "gid://shopify/AppInstallation/1", expectedRaw: null, next }));
    const back = parseSettings(store.state.raw);
    expect(back.source).toBe("saved");
    expect(back.settings.groups.groups.seo).toBe(false);
    expect(back.settings.thresholds.minImages).toBe(3);
    expect(JSON.parse(store.state.raw!).version).toBe(2);
  });
  it("a value outside its rule is refused before anything is sent", async () => {
    const store = fakeStore(null);
    const next = make((s) => (s.thresholds.seoDescMin = 400));
    await expect(runUnlocked(() => saveBlockSettings(store.gql, { installationId: "x", expectedRaw: null, next }))).rejects.toThrow(/Nothing was saved/);
    expect(store.state.sets).toBe(0);
  });
});
