// The fixes for the problems on the Overview.
//  1. unpublish: take the affected products out of that market's catalogues.
//  2. countries: add the market's countries to one zone (that has rates) of the profile.
//  3. unify: move products whose variants are in different profiles into one profile (a normal move).
// Each is planned first (nothing is written) and applied only after the person confirms and gives the password.

import { adminGraphql, assertNoUserErrors } from "./admin";
import { assertProfilesAreLive } from "./shippingMode";
import { planMove, type MovePlan } from "./move";
import { focusOf, matchFocus, type ProductLine, type Shipper } from "./overview";
import { loadProfileFresh } from "./shopify-data";
import type { Market, Membership, Parts, ProductRow, ProfileSummary, ProfileZone } from "./types";

export type FixKind = "unpublish" | "countries";
export type FixRequest =
  | { kind: FixKind; profileKey: string; marketId: string; state: "blocked" | "partial" }
  | { kind: "unify" };

/**
 * Active products wholly in the profile that are published in the market and blocked (or partly blocked) there.
 * Products split across profiles are left out: they have their own problem and their own fix.
 */
export function affectedLines(lines: ProductLine[], profileKey: string, marketId: string, state: "blocked" | "partial" = "blocked"): ProductLine[] {
  const focus = focusOf({ profileKey, marketId, state, activeOnly: true });
  return lines.filter((l) => !l.split && matchFocus(l, focus));
}

/** Fix 1. Only this market's catalogues change, and shipping is never touched. */
export function planUnpublishFix(input: {
  products: ProductRow[];
  membership: Membership;
  parts?: Parts;
  target: Shipper;
  shippers: Shipper[];
  markets: Market[];
  marketId: string;
}): MovePlan {
  const plan = planMove({
    products: input.products,
    membership: input.membership,
    parts: input.parts,
    target: input.target,
    shippers: input.shippers,
    markets: input.markets,
    mode: "unpublish",
  });
  const lines = plan.lines
    .map((l) => ({ ...l, shippingChange: false, changes: l.changes.filter((c) => c.market.id === input.marketId) }))
    .filter((l) => l.changes.length > 0);
  const perMarket = plan.perMarket.map((m) =>
    m.coverage.market.id === input.marketId ? { ...m, publish: 0 } : { ...m, publish: 0, unpublish: 0 },
  );
  const unpublish = lines.reduce((n, l) => n + l.changes.length, 0);
  return {
    ...plan,
    lines,
    unchanged: [],
    perMarket,
    totals: { shipping: 0, publish: 0, unpublish },
    blocker: lines.length === 0 ? "Nothing to unpublish. These products may already be fixed." : plan.blocker,
    warnings: plan.warnings.filter((w) => !/shipping rates/.test(w)),
  };
}

// ---- Fix 2: add countries to a zone -----------------------------------------

/** Zones that can sell: they have rates (or their rates are unknown). A zone with no rates would not help. */
export const ratedZones = (zones: ProfileZone[]): ProfileZone[] => zones.filter((z) => z.rateCount !== 0);

/** The rated zone that already holds the most of the market's countries (the natural place to add the rest). */
export function defaultZoneId(zones: ProfileZone[], market: Market): string {
  const codes = new Set(market.countries.map((c) => c.code));
  const candidates = ratedZones(zones);
  let best = candidates[0];
  let bestScore = -1;
  for (const z of candidates) {
    const score = z.countries.filter((c) => codes.has(c)).length;
    if (score > bestScore) {
      best = z;
      bestScore = score;
    }
  }
  return best?.id ?? "";
}

export type CountryFix = {
  zone: ProfileZone;
  /** Market countries that are in no zone of the profile yet. They will be added. */
  add: string[];
  /** Market countries that sit in a zone WITHOUT rates. Adding them here would put them in two zones: add a rate to that zone in Shopify instead. */
  needRates: string[];
  /** Everything the zone will contain afterwards. */
  after: string[];
  blocker: string | null;
};

/** Fix 2. Which countries would be added to which zone. Plans nothing when the zone has no rates. */
export function planCountryFix(input: {
  zones: ProfileZone[];
  zoneId: string;
  market: Market;
  /** Countries the profile ships to (zones with rates). */
  shipsAlready: string[];
  /** Countries listed in zones without rates. */
  unrated?: string[];
}): CountryFix | null {
  const candidates = ratedZones(input.zones);
  const zone = candidates.find((z) => z.id === input.zoneId) ?? candidates[0];
  if (!zone) return null;
  const have = new Set(input.shipsAlready);
  const unrated = new Set(input.unrated ?? []);
  const missing = input.market.countries.map((c) => c.code).filter((c) => !have.has(c));
  const add = missing.filter((c) => !unrated.has(c));
  const needRates = missing.filter((c) => unrated.has(c));
  const after = [...new Set([...zone.countries, ...add])];
  return {
    zone,
    add,
    needRates,
    after,
    blocker:
      add.length > 0
        ? null
        : needRates.length > 0
          ? "These countries are in a zone that has no rates. Add a rate to that zone in Shopify; the app cannot move them."
          : "The profile already ships to all of this market's countries.",
  };
}

/** The Shopify input for one zone. The countries list REPLACES the zone's countries. */
export function countryFixInput(fix: CountryFix) {
  return {
    locationGroupsToUpdate: [
      {
        id: fix.zone.locationGroupId,
        zonesToUpdate: [
          {
            id: fix.zone.id,
            countries: [
              ...fix.after.map((code) => ({ code, includeAllProvinces: true })),
              ...(fix.zone.restOfWorld ? [{ restOfWorld: true }] : []),
            ],
          },
        ],
      },
    ],
  };
}

const UPDATE_ZONE = `#graphql
  mutation FixZoneCountries($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      userErrors { field message }
    }
  }
`;

export async function applyCountryFix(profileId: string, fix: CountryFix): Promise<void> {
  const data = await adminGraphql<{
    deliveryProfileUpdate: { userErrors: { field: string[] | null; message: string }[] };
  }>(UPDATE_ZONE, { id: profileId, profile: countryFixInput(fix) });
  assertNoUserErrors(data.deliveryProfileUpdate.userErrors, "Adding countries to the profile");
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** BEFORE Apply: is the zone still as it was when the review was built? Returns a message when not. */
export function zoneDrift(fresh: ProfileSummary | null, fix: CountryFix): string | null {
  if (!fresh) return "The shipping profile was not found. It may have been deleted.";
  const zone = fresh.zones.find((z) => z.id === fix.zone.id);
  if (!zone) return "The zone was not found. It may have been deleted or renamed in Shopify.";
  if (zone.rateCount === 0) return "The zone has no active rates now.";
  if (!sameSet(zone.countries, fix.zone.countries)) return "The zone's countries changed since the review.";
  return null;
}

/** AFTER Apply: the countries that Shopify still does not show in the zone. Empty = verified. */
export function zoneMissing(fresh: ProfileSummary | null, fix: CountryFix): string[] {
  const zone = fresh?.zones.find((z) => z.id === fix.zone.id);
  if (!zone) return fix.add;
  return fix.add.filter((c) => !zone.countries.includes(c));
}

export type CountryFixOutcome = {
  status: "done" | "not verified";
  /** Countries the zone should have but Shopify does not show. */
  missing: string[];
  message: string;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Recheck the zone, write, read it back. Throws (without writing) when the zone changed since the review.
 * Must run inside runUnlocked (the password dialog does that).
 */
export async function runCountryFix(profileId: string, fix: CountryFix): Promise<CountryFixOutcome> {
  await assertProfilesAreLive();
  const drift = zoneDrift(await loadProfileFresh(profileId), fix);
  if (drift) throw new Error(`${drift} Nothing was changed. Go back and review again.`);
  await applyCountryFix(profileId, fix);
  let missing = zoneMissing(await loadProfileFresh(profileId), fix);
  if (missing.length > 0) {
    await wait(1500);
    missing = zoneMissing(await loadProfileFresh(profileId), fix);
  }
  return missing.length === 0
    ? { status: "done", missing, message: "" }
    : { status: "not verified", missing, message: `Shopify answered ok but does not show ${missing.join(", ")} in the zone.` };
}
