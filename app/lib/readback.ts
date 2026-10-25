// Reads products fresh from Shopify and compares them with a plan:
//  - findDrift: BEFORE Apply. Did anything change since the review was built?
//  - findMismatch: AFTER Apply. Does Shopify really show what we asked for?
// (deliveryProfileUpdate can answer "ok" and still ignore a field, so success is never taken on trust.)
// The reads are free. The comparison functions are pure.

import { adminGraphql } from "./admin";
import { GENERAL, NO_PROFILE } from "./keys";
import type { MoveLine } from "./move";

export type VariantState = { id: string; profileKey: string };

export type ProductState = {
  id: string;
  status: string;
  /** Market catalogues it is published in. */
  catalogIds: string[];
  /** Null when variants were not read. */
  variants: VariantState[] | null;
  /** False when the product has more variants than were read. */
  variantsComplete: boolean;
};

const CATALOGS = `#graphql
  query ReadbackCatalogs($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        status
        resourcePublicationsV2(first: 10, onlyPublished: true, catalogType: MARKET) {
          nodes { publication { catalog { id } } }
        }
      }
    }
  }
`;

// 3 products x 250 variants stays under Shopify's 1,000 per-query cost limit.
const VARIANTS = `#graphql
  query ReadbackVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        variants(first: 250) {
          pageInfo { hasNextPage }
          nodes { id deliveryProfile { id default } }
        }
      }
    }
  }
`;

const CATALOG_CHUNK = 20;
export const VARIANT_CHUNK = 3;

type RawCatalogNode = {
  id: string;
  status: string;
  resourcePublicationsV2?: { nodes: { publication?: { catalog?: { id: string } | null } | null }[] };
} | null;

type RawVariantNode = {
  id: string;
  variants: { pageInfo: { hasNextPage: boolean }; nodes: { id: string; deliveryProfile: { id: string; default: boolean } | null }[] };
} | null;

export function profileKeyOf(p: { id: string; default: boolean } | null): string {
  if (!p) return NO_PROFILE;
  return p.default ? GENERAL : p.id;
}

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Fresh state of products. Variants are only read for `withVariants` (it costs more). */
export async function readState(ids: string[], withVariants: string[] = []): Promise<Record<string, ProductState>> {
  const out: Record<string, ProductState> = {};
  for (const part of chunks([...new Set(ids)], CATALOG_CHUNK)) {
    const data = await adminGraphql<{ nodes: RawCatalogNode[] }>(CATALOGS, { ids: part });
    for (const n of data.nodes) {
      if (!n) continue;
      out[n.id] = {
        id: n.id,
        status: n.status,
        catalogIds: (n.resourcePublicationsV2?.nodes ?? []).flatMap((x) => (x.publication?.catalog?.id ? [x.publication.catalog.id] : [])),
        variants: null,
        variantsComplete: true,
      };
    }
  }
  for (const part of chunks([...new Set(withVariants)], VARIANT_CHUNK)) {
    const data = await adminGraphql<{ nodes: RawVariantNode[] }>(VARIANTS, { ids: part });
    for (const n of data.nodes) {
      const state = n ? out[n.id] : undefined;
      if (!n || !state) continue;
      state.variants = n.variants.nodes.map((v) => ({ id: v.id, profileKey: profileKeyOf(v.deliveryProfile) }));
      state.variantsComplete = !n.variants.pageInfo.hasNextPage;
    }
  }
  return out;
}

export type Finding = { productId: string; title: string; message: string };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * BEFORE Apply: has the store moved on since the review was built?
 * Checks status, the catalogues, and (for products that move) where the variants are.
 */
export function findDrift(lines: MoveLine[], state: Record<string, ProductState>): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const s = state[l.product.id];
    const title = l.product.title;
    if (!s) {
      out.push({ productId: l.product.id, title, message: "Product not found. It may have been deleted." });
      continue;
    }
    if (s.status !== l.product.status) {
      out.push({ productId: l.product.id, title, message: `Status changed from ${l.product.status} to ${s.status}.` });
      continue;
    }
    if (!sameSet(s.catalogIds, l.product.catalogs.map((c) => c.id))) {
      out.push({ productId: l.product.id, title, message: "Its catalogues changed since the review." });
      continue;
    }
    if (l.shippingChange && s.variants && s.variantsComplete) {
      // Counts are unknown (0) when the profile contents were capped or unreadable. A product in General alone is always known.
      const known = l.fromParts.every((p) => p.variants > 0) || (l.fromParts.length === 1 && l.fromParts[0]?.key === GENERAL);
      const now = [...new Set(s.variants.map((v) => v.profileKey))];
      if (known && !sameSet(now, l.fromParts.map((p) => p.key))) {
        out.push({ productId: l.product.id, title, message: "Its shipping profile changed since the review." });
      }
    }
  }
  return out;
}

/** AFTER Apply: what Shopify shows against what the plan asked for. Empty = everything matches. */
export function findMismatch(lines: MoveLine[], state: Record<string, ProductState>, targetKey: string, targetName: string): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const s = state[l.product.id];
    const title = l.product.title;
    if (!s) {
      out.push({ productId: l.product.id, title, message: "Could not read the product back." });
      continue;
    }
    if (l.shippingChange) {
      if (!s.variants) out.push({ productId: l.product.id, title, message: "Could not read its variants back." });
      else if (s.variants.length === 0) out.push({ productId: l.product.id, title, message: "Has no variants to check." });
      else {
        const wrong = s.variants.filter((v) => v.profileKey !== targetKey).length;
        if (wrong > 0) {
          out.push({
            productId: l.product.id,
            title,
            message: `Shopify still shows ${wrong} of ${s.variants.length} variant${s.variants.length === 1 ? "" : "s"} outside "${targetName}"${s.variantsComplete ? "" : " (first 250 checked)"}.`,
          });
        }
      }
    }
    for (const c of l.changes) {
      const has = s.catalogIds.includes(c.catalog.id);
      if (c.kind === "publish" && !has) out.push({ productId: l.product.id, title, message: `Not published in ${c.market.name} (${c.catalog.title}) after the change.` });
      if (c.kind === "unpublish" && has) out.push({ productId: l.product.id, title, message: `Still published in ${c.market.name} (${c.catalog.title}) after the change.` });
    }
  }
  return out;
}

// ---- Publications (sales channels and catalogues) -----------------------------

export type PublicationState = {
  id: string;
  status: string;
  /** Every publication the product is published to: sales channels and market catalogues. */
  publicationIds: string[];
  /** False when the product is published to more than were read. */
  complete: boolean;
};

const PUBLICATIONS = `#graphql
  query ReadbackPublications($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        status
        resourcePublicationsV2(first: 40, onlyPublished: true) {
          pageInfo { hasNextPage }
          nodes { publication { id } }
        }
      }
    }
  }
`;

type RawPublicationNode = {
  id: string;
  status: string;
  resourcePublicationsV2?: { pageInfo?: { hasNextPage: boolean }; nodes: { publication?: { id: string } | null }[] };
} | null;

/** Fresh channel + catalogue publications of products. 20 products x 40 publications stays under the 1,000 cost limit. */
export async function readPublications(ids: string[]): Promise<Record<string, PublicationState>> {
  const out: Record<string, PublicationState> = {};
  for (const part of chunks([...new Set(ids)], CATALOG_CHUNK)) {
    const data = await adminGraphql<{ nodes: RawPublicationNode[] }>(PUBLICATIONS, { ids: part });
    for (const n of data.nodes) {
      if (!n) continue;
      out[n.id] = {
        id: n.id,
        status: n.status,
        publicationIds: (n.resourcePublicationsV2?.nodes ?? []).flatMap((x) => (x.publication?.id ? [x.publication.id] : [])),
        complete: n.resourcePublicationsV2?.pageInfo?.hasNextPage !== true,
      };
    }
  }
  return out;
}
