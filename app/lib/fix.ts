// The two fixes for "published in a market but cannot be bought there".
//  1. unpublish: take the affected products out of that market's catalogues.
//  2. countries: add the market's countries to one zone of the profile.
// Both are planned first (nothing is written) and applied only after the
// person confirms and gives the password.

import { adminGraphql, assertNoUserErrors } from "./admin";
import { planMove, type MovePlan } from "./move";
import { focusOf, matchFocus, type ProductLine, type Shipper } from "./overview";
import type { Market, Membership, ProductRow, ProfileZone } from "./types";

export type FixKind = "unpublish" | "countries";
export type FixRequest = { kind: FixKind; profileKey: string; marketId: string };

/** Active products of the profile that are published in the market and blocked there. */
export function affectedLines(lines: ProductLine[], profileKey: string, marketId: string): ProductLine[] {
  const focus = focusOf({ profileKey, marketId, state: "blocked", activeOnly: true });
  return lines.filter((l) => matchFocus(l, focus));
}

/** Fix 1. Only this market's catalogues change, and shipping is never touched. */
export function planUnpublishFix(input: {
  products: ProductRow[];
  membership: Membership;
  target: Shipper;
  shippers: Shipper[];
  markets: Market[];
  marketId: string;
}): MovePlan {
  const plan = planMove({
    products: input.products,
    membership: input.membership,
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

export type CountryFix = {
  zone: ProfileZone;
  /** Market countries that are not in the profile yet. */
  add: string[];
  /** Everything the zone will contain afterwards. */
  after: string[];
  blocker: string | null;
};

/** Fix 2. Which countries would be added to which zone. */
export function planCountryFix(input: { zones: ProfileZone[]; zoneId: string; market: Market; shipsAlready: string[] }): CountryFix | null {
  const zone = input.zones.find((z) => z.id === input.zoneId) ?? input.zones[0];
  if (!zone) return null;
  const have = new Set(input.shipsAlready);
  const add = input.market.countries.map((c) => c.code).filter((c) => !have.has(c));
  const after = [...new Set([...zone.countries, ...add])];
  return {
    zone,
    add,
    after,
    blocker: add.length === 0 ? "The profile already ships to all of this market's countries." : null,
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
