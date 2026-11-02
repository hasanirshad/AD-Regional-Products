// A translation of a metafield that has no saved value yet ("deferred"). Shopify translates a metafield by its own id,
// which only exists once the value is saved. So the editor lets a person type the value and its translations together:
// the translation target carries a stand-in id plus the owner and key, and the real id is looked up here, after the
// value has been saved in the same run. Pure helpers plus one read.

import { mfKey } from "./doc";
import { chunks, gqlString, type Gql } from "./gql";
import type { Target } from "./model";

export type TranslationTarget = Extract<Target, { kind: "translation" }>;
export type Defer = NonNullable<TranslationTarget["defer"]>;

/** The stand-in resource id of a deferred translation. Unique per owner and metafield. */
export const deferredResourceId = (d: Defer): string => `defer:${d.ownerId}|${mfKey(d.namespace, d.key)}`;

export const isDeferred = (t: Target): t is TranslationTarget & { defer: Defer } => t.kind === "translation" && Boolean(t.defer);

const lookupKey = (d: Defer): string => `${d.ownerId}|${mfKey(d.namespace, d.key)}`;

export function buildMetafieldIdsRead(keys: { namespace: string; key: string }[]): string {
  const fields = keys.map((k, i) => `m${i}: metafield(namespace: ${gqlString(k.namespace)}, key: ${gqlString(k.key)}) { id value }`).join("\n        ");
  return `#graphql
  query ReadMetafieldIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id ${fields} }
      ... on ProductVariant { id ${fields} }
    }
  }`;
}

/**
 * Looks up the real metafield id of each deferred target. Result: "ownerId|namespace.key" -> the metafield id, or null
 * when the owner has no such metafield (no saved value, so there is nothing to translate yet). An owner that no longer
 * exists is left out of the map.
 */
export async function resolveDeferred(gql: Gql, defers: Defer[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (defers.length === 0) return out;
  const keys = new Map<string, { namespace: string; key: string }>();
  for (const d of defers) keys.set(mfKey(d.namespace, d.key), { namespace: d.namespace, key: d.key });
  const owners = [...new Set(defers.map((d) => d.ownerId))];
  for (const keyGroup of chunks([...keys.values()], 20)) {
    const query = buildMetafieldIdsRead(keyGroup);
    for (const group of chunks(owners, 25)) {
      const data = await gql<{ nodes: (Record<string, unknown> | null)[] }>(query, { ids: group });
      for (const node of data.nodes) {
        if (!node || typeof node.id !== "string") continue;
        keyGroup.forEach((k, i) => {
          const m = node[`m${i}`] as { id: string; value: string | null } | null | undefined;
          out.set(`${node.id}|${mfKey(k.namespace, k.key)}`, m && m.value !== null ? m.id : null);
        });
      }
    }
  }
  return out;
}

/** The real resource id for a deferred target, from a lookup made with resolveDeferred. */
export const resolvedId = (lookup: Map<string, string | null>, d: Defer): string | null | undefined => lookup.get(lookupKey(d));
