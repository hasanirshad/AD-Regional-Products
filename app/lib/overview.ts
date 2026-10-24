// Read-only picture of the whole setup: which products are published where
// (market catalogues) and where they can actually be bought (shipping profile).
// Pure functions, no Shopify calls.

import type { Group, Market, Membership, ProductRow, ProfileSummary } from "./types";

/** How one product stands in one market. */
export type CellState =
  | "sellable" // published, and every country of the market can check out
  | "partial" // published, some countries can check out, the rest are blocked at checkout
  | "blocked" // published, but no country of the market can check out
  | "unpublished"; // not in this market's catalogue

export type Shipper = {
  /** Group id, or GENERAL for products in no group. */
  key: string;
  name: string;
  profile: ProfileSummary | null;
};

export const GENERAL = "__general__";

export function shipsTo(profile: Pick<ProfileSummary, "countries" | "restOfWorld"> | null, code: string): boolean {
  if (!profile) return false;
  return profile.restOfWorld || profile.countries.includes(code.toUpperCase());
}

/** General first, then one per group (profile null when it does not exist). */
export function makeShippers(profiles: ProfileSummary[], groups: Group[]): Shipper[] {
  return [
    { key: GENERAL, name: "General (no group)", profile: profiles.find((p) => p.isDefault) ?? null },
    ...groups.map((g) => ({
      key: g.id,
      name: g.name,
      profile: profiles.find((p) => p.id === g.profileId) ?? null,
    })),
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

export type GroupSummary = {
  key: string;
  name: string;
  /** Countries the group is meant to allow. General has none to compare with. */
  allowed: string[];
  profile: ProfileSummary | null;
  products: number;
  perMarket: { coverage: Coverage; counts: Record<CellState, number> }[];
};

export type CatalogSummary = { id: string; title: string; markets: string[]; products: number };

export type Issue = {
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
  /** The products this problem is about. */
  focus?: Focus;
};

/** What the Products tab is showing. Every field narrows the list. */
export type Focus = {
  /** Only active products. */
  activeOnly: boolean;
  groupKey: string;
  marketId: string;
  /** With a market: that market's state. "published" = anything but unpublished. */
  state: "" | CellState | "published";
  catalogId: string;
  /** "" all, "nocat" in no catalogue, "problem" published where it cannot be bought, "ok" no problems. */
  show: "" | "nocat" | "problem" | "ok";
  inAnyGroup: boolean;
};

export const NO_FOCUS: Focus = {
  activeOnly: false,
  groupKey: "",
  marketId: "",
  state: "",
  catalogId: "",
  show: "",
  inAnyGroup: false,
};

export const focusOf = (patch: Partial<Focus>): Focus => ({ ...NO_FOCUS, ...patch });

export function matchFocus(l: ProductLine, f: Focus): boolean {
  const p = l.product;
  if (f.activeOnly && p.status !== "ACTIVE") return false;
  if (f.groupKey && l.groupKey !== f.groupKey) return false;
  if (f.inAnyGroup && l.groupKey === GENERAL) return false;
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
  if (f.show === "ok" && !(p.status === "ACTIVE" && !l.hasProblem && p.catalogs.length > 0)) return false;
  return true;
}

export type ProductLine = {
  product: ProductRow;
  groupKey: string;
  groupName: string;
  cells: Record<string, CellState>; // by market id
  /** True when it is published somewhere it cannot be bought (fully or partly). */
  hasProblem: boolean;
};

export type Overview = {
  totals: {
    products: number;
    active: number;
    inGroups: number;
    noCatalogue: number;
    groups: number;
    markets: number;
  };
  markets: MarketSummary[];
  groups: GroupSummary[];
  catalogs: CatalogSummary[];
  lines: ProductLine[];
  issues: Issue[];
  shippers: Shipper[];
};

const emptyCounts = (): Record<CellState, number> => ({ sellable: 0, partial: 0, blocked: 0, unpublished: 0 });

function sameSet(a: string[], b: string[]): boolean {
  const x = new Set(a.map((c) => c.toUpperCase()));
  const y = new Set(b.map((c) => c.toUpperCase()));
  return x.size === y.size && [...x].every((c) => y.has(c));
}

export function buildOverview(input: {
  markets: Market[];
  profiles: ProfileSummary[];
  groups: Group[];
  rows: ProductRow[];
  membership: Membership;
}): Overview {
  const { profiles, groups, rows, membership } = input;
  const markets = sellingMarkets(input.markets);
  const general = profiles.find((p) => p.isDefault) ?? null;

  const shippers = makeShippers(profiles, groups);
  const shipperOf = (productId: string): Shipper => {
    const gid = membership[productId];
    return shippers.find((s) => s.key === gid && s.profile) ?? shippers[0]!;
  };

  const coverageBy = new Map<string, Coverage[]>();
  for (const s of shippers) coverageBy.set(s.key, markets.map((m) => coverage(s.profile, m)));

  // Only active products can be sold, so only they are counted in the grids.
  const active = rows.filter((r) => r.status === "ACTIVE");

  const lines: ProductLine[] = rows.map((product) => {
    const s = shipperOf(product.id);
    const covs = coverageBy.get(s.key) ?? [];
    const cells: Record<string, CellState> = {};
    markets.forEach((m, i) => {
      const cov = covs[i];
      if (cov) cells[m.id] = cellState(isPublishedIn(product, m), cov);
    });
    const hasProblem = Object.values(cells).some((c) => c === "blocked" || c === "partial");
    return { product, groupKey: s.key, groupName: s.name, cells, hasProblem };
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

  const groupSummaries: GroupSummary[] = shippers.map((s) => {
    const mine = activeLines.filter((l) => l.groupKey === s.key);
    const group = groups.find((g) => g.id === s.key);
    return {
      key: s.key,
      name: s.name,
      allowed: group?.countries ?? [],
      profile: s.profile,
      products: mine.length,
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
  for (const g of groups) {
    const profile = profiles.find((p) => p.id === g.profileId);
    if (!g.profileId) {
      issues.push({
        level: "warning",
        title: `Group "${g.name}" has no shipping profile yet`,
        detail: "Open the group and save it to create the profile. Products cannot be moved into it before that.",
        focus: focusOf({ groupKey: g.id }),
      });
      continue;
    }
    if (!profile) {
      issues.push({
        level: "critical",
        title: `Group "${g.name}": its shipping profile is missing in Shopify`,
        detail: "It was deleted outside the app. Open the group and save it to create it again.",
        focus: focusOf({ groupKey: g.id }),
      });
      continue;
    }
    if (profile.rateCount === 0) {
      issues.push({
        level: "critical",
        title: `Profile "${profile.name}" has no active shipping rates`,
        detail: "Customers cannot check out products in this group. Add rates in Shopify shipping settings.",
        focus: focusOf({ groupKey: g.id }),
      });
    }
    if (!profile.zonesTruncated && !profile.restOfWorld && !sameSet(profile.countries, g.countries)) {
      issues.push({
        level: "warning",
        title: `Profile "${profile.name}" ships to different countries than the group allows`,
        detail: "It was probably edited in Shopify. Open the group and save it to realign the profile.",
        focus: focusOf({ groupKey: g.id }),
      });
    }
    if (profile.zonesTruncated) {
      issues.push({
        level: "info",
        title: `Profile "${profile.name}" has many zones`,
        detail: "Only the first zones were read, so the checkout countries shown for it may be incomplete.",
      });
    }
  }
  if (!general) {
    issues.push({
      level: "critical",
      title: "No General shipping profile found",
      detail: "Shopify always has one. Reload the app; if this stays, check the app's shipping access.",
    });
  }
  for (const gs of groupSummaries) {
    for (const pm of gs.perMarket) {
      if (pm.counts.blocked > 0) {
        issues.push({
          level: "critical",
          title: `${pm.counts.blocked} ${gs.name} product${pm.counts.blocked === 1 ? "" : "s"} published in ${pm.coverage.market.name} but cannot be bought there`,
          detail: `${gs.name} ships to none of ${pm.coverage.market.name}'s countries. Unpublish them from that market, or add the countries to the group.`,
          focus: focusOf({ groupKey: gs.key, marketId: pm.coverage.market.id, state: "blocked", activeOnly: true }),
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

  const order = { critical: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.level] - order[b.level]);

  return {
    totals: {
      products: rows.length,
      active: active.length,
      inGroups: rows.filter((r) => membership[r.id]).length,
      noCatalogue,
      groups: groups.length,
      markets: markets.length,
    },
    markets: marketSummaries,
    groups: groupSummaries,
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
