// Market-driven shipping (Shopify, from 2026-07): shipping moves from merchant delivery profiles into Markets.
// For a shop on it, reads of deliveryProfiles may be a stale snapshot and deliveryProfileUpdate "succeeds" without
// changing live shipping. This app's groups ARE merchant delivery profiles, so every write that touches a profile
// must stop on such a shop. Reading the mode is free; an unreadable answer is "unknown" and does not block.

import { adminGraphql } from "./admin";

export type ShippingMode = "market-driven" | "profiles" | "unknown";

const MODE = `#graphql
  query ShippingMode { shop { features { marketDrivenShipping } } }`;

export const MARKET_DRIVEN_MESSAGE =
  "This store uses market-driven shipping. Shopify no longer applies changes made to shipping profiles there, so the app has not changed anything. " +
  "Change shipping in Shopify under Settings, Markets.";

export async function readShippingMode(): Promise<ShippingMode> {
  try {
    const data = await adminGraphql<{ shop: { features: { marketDrivenShipping: boolean | null } | null } | null }>(MODE);
    const flag = data.shop?.features?.marketDrivenShipping;
    return flag === true ? "market-driven" : flag === false ? "profiles" : "unknown";
  } catch {
    return "unknown";
  }
}

/** Call before the first profile write. Throws, without writing, on a market-driven shop. */
export async function assertProfilesAreLive(): Promise<void> {
  if ((await readShippingMode()) === "market-driven") throw new Error(MARKET_DRIVEN_MESSAGE);
}
