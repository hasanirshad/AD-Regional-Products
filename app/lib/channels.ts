// Sales channels and catalogues: which products are published where, and the plan for changing it for many at once.
// A channel (Online Store, ...) and a market catalogue are both "publications": publishing is the same call for both.
// Pure functions, no Shopify calls.

import { coverageParts } from "./overview";
import { GENERAL } from "./keys";
import { partsOf } from "./parts";
import type { PublicationState } from "./readback";
import type { Market, Membership, Parts, ProductRow, ProfileSummary } from "./types";

export type Channel = { id: string; name: string };

/** One place a product can be published to. `id` is the publication id. */
export type Target = {
  id: string;
  label: string;
  kind: "channel" | "catalog";
  /** "Sales channels", or the market name. */
  group: string;
  marketId?: string;
};

export type Pick = "publish" | "unpublish";
export type Choice = Record<string, Pick>;

export type PubChange = { target: Target; op: Pick };

export type PubLine = {
  product: ProductRow;
  /** Every publication id it was in when the plan was built (to spot changes before Apply). */
  current: string[];
  status: string;
  changes: PubChange[];
};

export type PubPlan = {
  /** Products with something to change. */
  lines: PubLine[];
  unchanged: ProductRow[];
  /** Left out: not active, not found, or published to too many places to read. */
  skipped: { product: ProductRow; reason: string }[];
  /** The targets the person picked, in the order shown. */
  chosen: { target: Target; op: Pick }[];
  /** All targets, to describe a product's state in the report. */
  targets: Target[];
  totals: { publish: number; unpublish: number };
  blocker: string | null;
  warnings: string[];
};

/** Channels first, then every catalogue of every market (hidden markets included on this page). */
export function buildTargets(input: { channels: Channel[]; markets: Market[]; hiddenMarkets: Market[] }): {
  targets: Target[];
  /** Catalogues that cannot be changed because they have no publication. */
  unavailable: { label: string; group: string }[];
} {
  const targets: Target[] = input.channels.map((c) => ({ id: c.id, label: c.name, kind: "channel", group: "Sales channels" }));
  const unavailable: { label: string; group: string }[] = [];
  const hiddenIds = new Set(input.hiddenMarkets.map((m) => m.id));
  for (const m of [...input.markets, ...input.hiddenMarkets]) {
    const group = hiddenIds.has(m.id) ? `${m.name} (market)` : m.name;
    for (const c of m.catalogs) {
      if (c.publicationId) targets.push({ id: c.publicationId, label: c.title, kind: "catalog", group, marketId: m.id });
      else unavailable.push({ label: c.title, group });
    }
  }
  return { targets, unavailable };
}

export function planPublish(input: {
  products: ProductRow[];
  states: Record<string, PublicationState>;
  targets: Target[];
  choice: Choice;
  markets: Market[];
  profiles: ProfileSummary[];
  membership: Membership;
  parts?: Parts;
}): PubPlan {
  const { products, states, targets, choice } = input;
  const chosen = targets.filter((t) => choice[t.id]).map((target) => ({ target, op: choice[target.id]! }));
  const lines: PubLine[] = [];
  const unchanged: ProductRow[] = [];
  const skipped: PubPlan["skipped"] = [];

  for (const product of products) {
    const s = states[product.id];
    if (!s) {
      skipped.push({ product, reason: "Not found. It may have been deleted." });
      continue;
    }
    if (s.status !== "ACTIVE") {
      skipped.push({ product, reason: `Not active (${s.status.toLowerCase()}).` });
      continue;
    }
    if (!s.complete) {
      skipped.push({ product, reason: "Published to too many places to read safely." });
      continue;
    }
    const has = new Set(s.publicationIds);
    const changes: PubChange[] = chosen
      .filter(({ target, op }) => (op === "publish" ? !has.has(target.id) : has.has(target.id)))
      .map(({ target, op }) => ({ target, op }));
    if (changes.length === 0) unchanged.push(product);
    else lines.push({ product, current: s.publicationIds, status: s.status, changes });
  }

  const totals = {
    publish: lines.reduce((n, l) => n + l.changes.filter((c) => c.op === "publish").length, 0),
    unpublish: lines.reduce((n, l) => n + l.changes.filter((c) => c.op === "unpublish").length, 0),
  };

  const warnings: string[] = [];
  const notActive = skipped.filter((s) => s.reason.startsWith("Not active")).length;
  if (notActive > 0) warnings.push(`${notActive} selected product${notActive === 1 ? " is" : "s are"} not active and left out.`);
  const other = skipped.length - notActive;
  if (other > 0) warnings.push(`${other} product${other === 1 ? " was" : "s were"} left out (not found, or published to too many places to read).`);

  for (const { target, op } of chosen) {
    if (op === "unpublish" && target.kind === "channel" && /online store/i.test(target.label)) {
      const n = lines.filter((l) => l.changes.some((c) => c.target.id === target.id)).length;
      if (n > 0) warnings.push(`${n} product${n === 1 ? "" : "s"} will be removed from ${target.label}. They disappear from the storefront, also in markets whose catalogue relies on it.`);
    }
  }

  // Published in a market whose customers cannot check out: tell before it happens.
  const profileOf = (key: string) => (key === GENERAL ? (input.profiles.find((p) => p.isDefault) ?? null) : (input.profiles.find((p) => p.id === key) ?? null));
  for (const { target, op } of chosen) {
    if (op !== "publish" || target.kind !== "catalog") continue;
    const market = input.markets.find((m) => m.id === target.marketId);
    if (!market || market.countries.length === 0) continue;
    let none = 0;
    let some = 0;
    for (const l of lines) {
      if (!l.changes.some((c) => c.target.id === target.id)) continue;
      const cov = coverageParts(partsOf(l.product.id, input.membership, input.parts).map((p) => profileOf(p.key)), market);
      if (cov.state === "none") none++;
      else if (cov.state === "mixed") some++;
    }
    if (none > 0) warnings.push(`${none} product${none === 1 ? "" : "s"} would be visible in ${market.name} but customers there cannot check out (no shipping).`);
    if (some > 0) warnings.push(`${some} product${some === 1 ? "" : "s"} would be visible in ${market.name} but only some of its countries can check out.`);
  }

  let blocker: string | null = null;
  if (products.length === 0) blocker = "No products selected.";
  else if (chosen.length === 0) blocker = "Choose at least one channel or catalogue.";
  else if (lines.length === 0) blocker = "Nothing would change: the products are already as chosen.";

  return { lines, unchanged, skipped, chosen, targets, totals, blocker, warnings };
}

/** Labels of the targets a product is in. */
export function labelsIn(publicationIds: string[], targets: Target[]): string[] {
  const has = new Set(publicationIds);
  return targets.filter((t) => has.has(t.id)).map((t) => t.label);
}
