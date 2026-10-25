// Read-only picture of the whole setup: which products are published where
// (market catalogues) and where they can actually be bought (shipping profile).
// Pure functions, no Shopify calls.

import { GENERAL } from "./keys";
import { isSplit, partsOf } from "./parts";
import type { Market, Membership, Parts, ProductRow, ProfileSummary } from "./types";

export { GENERAL };

/** How one product stands in one market. */
export type CellState =
  | "sellable" // published, and every country of the market can check out
  | "partial" // published, some countries can check out, the rest are blocked at checkout
  | "blocked" // published, but no country of the market can check out
  | "unpublished"; // not in this market's catalogue

export type Shipper = {
  /** The profile id, or GENERAL for the default profile. */
  key: string;
  name: string;
  profile: ProfileSummary | null;
  /** general = the default profile (products in no other profile). */
  kind: "general" | "profile";
};

export function shipsTo(profile: Pick<ProfileSummary, "countries" | "restOfWorld"> | null, code: string): boolean {
  if (!profile) return false;
  return profile.restOfWorld || profile.countries.includes(code.toUpperCase());
}

/** General first, then every other shipping profile in the store. */
export function makeShippers(profiles: ProfileSummary[]): Shipper[] {
  return [
    { key: GENERAL, name: "General (no profile)", profile: profiles.find((p) => p.isDefault) ?? null, kind: "general" },
    ...profiles
      .filter((p) => !p.isDefault)
      .map((p): Shipper => ({ key: p.id, name: p.name, profile: p, kind: "profile" })),
  ];
}

/** Markets that can sell anything: active, with at least one country. */
export function sellingMarkets(markets: Market[]): Market[] {
  return markets.filter((m) => m.status === "ACTIVE" && m.countries.length > 0);
}

export type Coverage = {
  market: Market;
  /** Countries of the market the profile ships to. */
  ships: string[];
  /** Countries of the market the profile does not ship to. */
  blocked: string[];
  state: "all" | "none" | "mixed";
};

export function coverage(profile: Pick<ProfileSummary, "countries" | "restOfWorld"> | null, market: Market): Coverage {
  const ships = market.countries.filter((c) => shipsTo(profile, c.code)).map((c) => c.code);
  const blocked = market.countries.filter((c) => !shipsTo(profile, c.code)).map((c) => c.code);
  return { market, ships, blocked, state: blocked.length === 0 ? "all" : ships.length === 0 ? "none" : "mixed" };
}

type ShipsProfile = Pick<ProfileSummary, "countries" | "restOfWorld"> | null;

/**
 * A product whose variants are in several profiles: a country is fine only when EVERY part ships there.
 * "none" = no country has every part shipping; "all" = every part ships everywhere; otherwise "mixed".
 */
export function coverageParts(profiles: ShipsProfile[], market: Market): Coverage {
  if (profiles.length === 1) return coverage(profiles[0] ?? null, market);
  const ships = market.countries.filter((c) => profiles.every((p) => shipsTo(p, c.code))).map((c) => c.code);
  const blocked = market.countries.filter((c) => !profiles.every((p) => shipsTo(p, c.code))).map((c) => c.code);
  return { market, ships, blocked, state: blocked.length === 0 ? "all" : ships.length === 0 ? "none" : "mixed" };
}

export function cellState(published: boolean, cov: Coverage): CellState {
  if (!published) return "unpublished";
  return cov.state === "all" ? "sellable" : cov.state === "mixed" ? "partial" : "blocked";
}

export function isPublishedIn(product: Pick<ProductRow, "catalogs">, market: Market): boolean {
  const ids = new Set(market.catalogs.map((c) => c.id));
  return product.catalogs.some((c) => ids.has(c.id));
}

// ---- Result shapes -------------------------------------------------------

export type MarketSummary = {
  market: Market;
  catalogs: string[];
  counts: Record<CellState, number>;
};

export type ProfileRow = {
  key: string;
  name: string;
  kind: Shipper["kind"];
  profile: ProfileSummary | null;
  /** Active products that are wholly in this profile. */
  products: number;
  /** Active products split across profiles, with some variants in this one. */
  splitProducts: number;
  /** Per market, for the products wholly in this profile (split products are left out). */
  perMarket: { coverage: Coverage; counts: Record<CellState, number> }[];
};

export type CatalogSummary = { id: string; title: string; markets: string[]; products: number };

export type Issue = {
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
  /** The products this problem is about. */
  focus?: Focus;
  /** What the fix buttons act on. */
  fix?: FixSpec;
};

/** The fixes a problem offers. "market": a profile and market. "unify": move split products into one profile. */
export type FixSpec =
  | { kind: "market"; profileKey: string; marketId: string; state: "blocked" | "partial"; actions: ("unpublish" | "countries")[] }
  | { kind: "unify" };

/** What the Products tab is showing. Every field narrows the list. */
export type Focus = {
  /** Only active products. */
  activeOnly: boolean;
  profileKey: string;
  marketId: string;
  /** With a market: that market's state. "published" = anything but unpublished. */
  state: "" | CellState | "published";
  catalogId: string;
  /** "" all, "nocat" in no catalogue, "problem" published where it cannot be bought, "ok" no problems, "split" variants in different profiles. */
  show: "" | "nocat" | "problem" | "ok" | "split";
  inProfile: boolean;
};

export const NO_FOCUS: Focus = {
  activeOnly: false,
  profileKey: "",
  marketId: "",
  state: "",
  catalogId: "",
  show: "",
  inProfile: false,
};

export const focusOf = (patch: Partial<Focus>): Focus => ({ ...NO_FOCUS, ...patch });

export function matchFocus(l: ProductLine, f: Focus): boolean {
  const p = l.product;
  if (f.activeOnly && p.status !== "ACTIVE") return false;
  if (f.profileKey && l.profileKey !== f.profileKey && !l.parts.some((p) => p.key === f.profileKey)) return false;
  if (f.inProfile && l.kind !== "profile") return false;
  if (f.catalogId && !p.catalogs.some((c) => c.id === f.catalogId)) return false;
  if (f.state) {
    const cells = f.marketId ? [l.cells[f.marketId]] : Object.values(l.cells);
    const ok = cells.some((c) => (f.state === "published" ? c !== undefined && c !== "unpublished" : c === f.state));
    if (!ok) return false;
  } else if (f.marketId && l.cells[f.marketId] === undefined) {
    return false;
  }
  if (f.show === "nocat" && !(p.status === "ACTIVE" && p.catalogs.length === 0)) return false;
  if (f.show === "problem" && !(p.status === "ACTIVE" && l.hasProblem)) return false;
  if (f.show === "ok" && !(p.status === "ACTIVE" && !l.hasProblem && !l.split && p.catalogs.length > 0)) return false;
  if (f.show === "split" && !l.split) return false;
  return true;
}

export type ProductLine = {
  product: ProductRow;
  profileKey: string;
  profileName: string;
  kind: Shipper["kind"];
  cells: Record<string, CellState>; // by market id
  /** True when it is published somewhere it cannot be bought (fully or partly). */
  hasProblem: boolean;
  /** Where its variants are, with the profile names. More than one = split across profiles. */
  parts: { key: string; name: string; variants: number }[];
  /** The variants are in more than one shipping profile. */
  split: boolean;
};

export type Overview = {
  totals: {
    products: number;
    active: number;
    /** In a profile other than General. */
    inProfiles: number;
    noCatalogue: number;
    profiles: number;
    markets: number;
    /** Active products whose variants are in different shipping profiles. */
    split: number;
  };
  markets: MarketSummary[];
  profiles: ProfileRow[];
  catalogs: CatalogSummary[];
  lines: ProductLine[];
  issues: Issue[];
  shippers: Shipper[];
};

const emptyCounts = (): Record<CellState, number> => ({ sellable: 0, partial: 0, blocked: 0, unpublished: 0 });

export function buildOverview(input: {
  markets: Market[];
  profiles: ProfileSummary[];
  rows: ProductRow[];
  membership: Membership;
  /** Where each product's variants are. Without it every product counts as whole, in its `membership` profile. */
  parts?: Parts;
  /** Things the products load wants to say (caps hit, counts unknown). */
  notes?: string[];
}): Overview {
  const { profiles, rows, membership } = input;
  const markets = sellingMarkets(input.markets);
  const general = profiles.find((p) => p.isDefault) ?? null;

  const shippers = makeShippers(profiles);
  const shipperOf = (productId: string): Shipper => {
    const gid = membership[productId];
    return shippers.find((s) => s.key === gid && s.profile) ?? shippers[0]!;
  };

  const coverageBy = new Map<string, Coverage[]>();
  for (const s of shippers) coverageBy.set(s.key, markets.map((m) => coverage(s.profile, m)));

  // Only active products can be sold, so only they are counted in the grids.
  const active = rows.filter((r) => r.status === "ACTIVE");

  const shipperByKey = (key: string): Shipper => shippers.find((s) => s.key === key) ?? shippers[0]!;

  const lines: ProductLine[] = rows.map((product) => {
    const list = partsOf(product.id, membership, input.parts);
    const split = isSplit(list);
    const s = split ? shipperByKey(list[0]!.key) : shipperOf(product.id);
    const cells: Record<string, CellState> = {};
    if (split) {
      // Every part must ship to a country for the product to be bought there.
      const partProfiles = list.map((p) => shipperByKey(p.key).profile);
      for (const m of markets) cells[m.id] = cellState(isPublishedIn(product, m), coverageParts(partProfiles, m));
    } else {
      const covs = coverageBy.get(s.key) ?? [];
      markets.forEach((m, i) => {
        const cov = covs[i];
        if (cov) cells[m.id] = cellState(isPublishedIn(product, m), cov);
      });
    }
    const hasProblem = Object.values(cells).some((c) => c === "blocked" || c === "partial");
    return {
      product,
      profileKey: s.key,
      profileName: s.name,
      kind: s.kind,
      cells,
      hasProblem,
      parts: list.map((p) => ({ key: p.key, name: shipperByKey(p.key).name, variants: p.variants })),
      split,
    };
  });
  const activeLines = lines.filter((l) => l.product.status === "ACTIVE");

  const marketSummaries: MarketSummary[] = markets.map((market) => {
    const counts = emptyCounts();
    for (const l of activeLines) {
      const c = l.cells[market.id];
      if (c) counts[c]++;
    }
    return { market, catalogs: market.catalogs.map((c) => c.title), counts };
  });

  const profileRows: ProfileRow[] = shippers.map((s) => {
    // Split products are shown on their own, not under one profile.
    const mine = activeLines.filter((l) => !l.split && l.profileKey === s.key);
    return {
      key: s.key,
      name: s.name,
      kind: s.kind,
      profile: s.profile,
      products: mine.length,
      splitProducts: activeLines.filter((l) => l.split && l.parts.some((p) => p.key === s.key)).length,
      perMarket: (coverageBy.get(s.key) ?? []).map((cov) => {
        const counts = emptyCounts();
        for (const l of mine) {
          const c = l.cells[cov.market.id];
          if (c) counts[c]++;
        }
        return { coverage: cov, counts };
      }),
    };
  });

  const catalogMap = new Map<string, CatalogSummary>();
  for (const m of input.markets) {
    for (const c of m.catalogs) {
      const entry = catalogMap.get(c.id) ?? { id: c.id, title: c.title, markets: [], products: 0 };
      entry.markets.push(m.name);
      catalogMap.set(c.id, entry);
    }
  }
  for (const p of active) for (const c of p.catalogs) {
    const entry = catalogMap.get(c.id);
    if (entry) entry.products++;
  }

  // ---- Issues -----------------------------------------------------------
  const issues: Issue[] = [];
  const noCatalogue = active.filter((p) => p.catalogs.length === 0).length;
  if (noCatalogue > 0) {
    issues.push({
      level: "warning",
      title: `${noCatalogue} active product${noCatalogue === 1 ? " is" : "s are"} in no catalogue`,
      detail: "They are not sold in any market.",
      focus: focusOf({ show: "nocat" }),
    });
  }
  for (const s of shippers) {
    if (s.kind !== "profile" || !s.profile) continue;
    if (s.profile.rateCount === 0 && s.profile.variantCount > 0) {
      issues.push({
        level: "critical",
        title: `Profile "${s.name}" has no active shipping rates`,
        detail: "Customers cannot check out products in this profile. Add rates in Shopify shipping settings.",
        focus: focusOf({ profileKey: s.key }),
      });
    }
    if (s.profile.zonesTruncated) {
      issues.push({
        level: "info",
        title: `Profile "${s.name}" has many zones`,
        detail: "Only the first zones were read, so the checkout countries shown for it may be incomplete.",
      });
    }
  }
  for (const s of shippers) {
    const pr = s.profile;
    if (!pr || !pr.ratesKnown || pr.variantCount === 0 || pr.rateCount === 0) continue;
    // Some rates exist, but a zone that lists countries has none: those countries cannot check out.
    const bare = pr.zones.filter((z) => z.rateCount === 0 && (z.countries.length > 0 || z.restOfWorld));
    for (const z of bare) {
      issues.push({
        level: "critical",
        title: `Zone "${z.name}" in profile "${s.name}" has countries but no active rates`,
        detail: `Customers in ${z.restOfWorld ? "the rest of the world" : z.countries.join(", ")} cannot check out products in this profile. The app does not count these countries as shipping. Add a rate to the zone in Shopify shipping settings.`,
        focus: focusOf({ profileKey: s.key }),
      });
    }
  }
  if (profiles.length > 0 && profiles.some((p) => !p.ratesKnown)) {
    issues.push({
      level: "info",
      title: "Shipping rates could not be read",
      detail: "The app could not read the rates of some profiles, so it assumes each listed zone has a rate. Reload to try again.",
    });
  }
  const splitCount = activeLines.filter((l) => l.split).length;
  if (splitCount > 0) {
    issues.push({
      level: "warning",
      title: `${splitCount} active product${splitCount === 1 ? " has" : "s have"} variants in different shipping profiles`,
      detail: "Shopify sets shipping per variant. A country can buy such a product only where every profile ships, so the app counts it by its weakest profile. Move the whole product into one profile to make it simple.",
      focus: focusOf({ show: "split", activeOnly: true }),
      fix: { kind: "unify" },
    });
  }
  if (!general) {
    issues.push({
      level: "critical",
      title: "No General shipping profile found",
      detail: "Shopify always has one. Reload the app; if this stays, check the app's shipping access.",
    });
  }
  for (const gs of profileRows) {
    for (const pm of gs.perMarket) {
      if (pm.counts.blocked > 0) {
        issues.push({
          level: "critical",
          title: `${pm.counts.blocked} ${gs.name} product${pm.counts.blocked === 1 ? "" : "s"} published in ${pm.coverage.market.name} but cannot be bought there`,
          detail: `${gs.name} ships to none of ${pm.coverage.market.name}'s countries. Unpublish them from that market, or add the countries to the profile in Shopify.`,
          focus: focusOf({ profileKey: gs.key, marketId: pm.coverage.market.id, state: "blocked", activeOnly: true }),
          fix: { kind: "market", profileKey: gs.key, marketId: pm.coverage.market.id, state: "blocked", actions: ["unpublish", "countries"] },
        });
      }
      if (pm.counts.partial > 0) {
        const n = pm.counts.partial;
        issues.push({
          level: "warning",
          title: `${n} ${gs.name} product${n === 1 ? "" : "s"} published in ${pm.coverage.market.name} but only some of its countries can check out`,
          detail: `${gs.name} does not ship to ${pm.coverage.blocked.join(", ")}. Customers there see the product but cannot buy it. Add those countries to a zone with rates.`,
          focus: focusOf({ profileKey: gs.key, marketId: pm.coverage.market.id, state: "partial", activeOnly: true }),
          fix: { kind: "market", profileKey: gs.key, marketId: pm.coverage.market.id, state: "partial", actions: ["countries"] },
        });
      }
    }
  }
  for (const m of markets) {
    if (m.catalogs.length === 0) {
      issues.push({
        level: "info",
        title: `Market "${m.name}" has no catalogue`,
        detail: "Nothing can be published to it until it has one.",
        focus: focusOf({ marketId: m.id, state: "unpublished", activeOnly: true }),
      });
    }
  }

  for (const note of input.notes ?? []) issues.push({ level: "info", title: note, detail: "" });

  const order = { critical: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.level] - order[b.level]);

  return {
    totals: {
      products: rows.length,
      active: active.length,
      inProfiles: lines.filter((l) => l.kind === "profile").length,
      noCatalogue,
      profiles: shippers.length - 1,
      markets: markets.length,
      split: splitCount,
    },
    markets: marketSummaries,
    profiles: profileRows,
    catalogs: [...catalogMap.values()],
    lines,
    issues,
    shippers,
  };
}

// ---- Checkout by country -------------------------------------------------

export type CountryRow = {
  code: string;
  name: string;
  markets: string[];
  ships: Record<string, boolean>; // by shipper key
};

/** Every country of every selling market, and which profiles can ship to it. */
export function countryMatrix(markets: Market[], shippers: Shipper[]): CountryRow[] {
  const rows = new Map<string, CountryRow>();
  for (const m of sellingMarkets(markets)) {
    for (const c of m.countries) {
      const row = rows.get(c.code) ?? { code: c.code, name: c.name, markets: [], ships: {} };
      row.markets.push(m.name);
      for (const s of shippers) row.ships[s.key] = shipsTo(s.profile, c.code);
      rows.set(c.code, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
