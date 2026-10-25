// Shipping profiles are set per VARIANT in Shopify. This turns what each
// profile holds into, per product: where its variants are, and the one
// profile that holds most of them (for filters and labels).
// Pure functions, no Shopify calls.

import { GENERAL } from "./keys";
import type { Membership, Part, Parts, ProductRow } from "./types";

export type ProfileEntries = Record<string, { key: string; variants: number; capped: boolean }[]>;

/**
 * - `entries`: product id -> variants held by each non-default profile (read from the profiles).
 * - A product's variants that sit in no other profile are in General: total variants - the rest.
 * - A product is split when its variants are in more than one place.
 * - Products with more than 250 variants in a profile cannot be counted: they are treated as whole.
 */
export function buildParts(
  rows: Pick<ProductRow, "id" | "variantCount">[],
  entries: ProfileEntries,
  variantsKnown = true,
): { membership: Membership; parts: Parts } {
  const totals = new Map(rows.map((r) => [r.id, r.variantCount]));
  const membership: Membership = {};
  const parts: Parts = {};

  for (const [productId, list] of Object.entries(entries)) {
    const found: Part[] = list
      .map((e) => ({ key: e.key, variants: e.variants }))
      .sort((a, b) => b.variants - a.variants);
    const primaryProfile = found[0];
    if (!primaryProfile) continue;
    membership[productId] = primaryProfile.key;

    const capped = list.some((e) => e.capped);
    const total = totals.get(productId) ?? 0;
    const inProfiles = found.reduce((n, p) => n + p.variants, 0);
    const result = [...found];
    if (variantsKnown && !capped && total > 0 && total > inProfiles) {
      result.push({ key: GENERAL, variants: total - inProfiles });
    }
    if (!variantsKnown || capped) {
      // Without variant counts we cannot tell: treat it as whole, in its first profile.
      parts[productId] = [{ key: primaryProfile.key, variants: 0 }];
      continue;
    }
    parts[productId] = result.sort((a, b) => b.variants - a.variants);
  }
  return { membership, parts };
}

/** Where a product's variants are. Falls back to the single profile in `membership`, or General. */
export function partsOf(productId: string, membership: Membership, parts?: Parts): Part[] {
  const found = parts?.[productId];
  if (found && found.length > 0) return found;
  return [{ key: membership[productId] ?? GENERAL, variants: 0 }];
}

export const isSplit = (list: Part[]): boolean => new Set(list.map((p) => p.key)).size > 1;
