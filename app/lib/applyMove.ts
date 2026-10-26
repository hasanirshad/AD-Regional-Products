// Runs a reviewed MovePlan against Shopify: shipping profile first, then
// catalogue publishing. A product whose shipping move fails is left alone
// (no catalogue changes) so it is never half-done.

import { adminGraphql, assertNoUserErrors } from "./admin";
import type { MovePlan } from "./move";

export type Failure = { productId: string; title: string; message: string };

export type MoveResult = {
  /** Products of the plan that were fully done (not failed, not skipped by Stop). */
  succeeded: string[];
  shippingMoved: number;
  published: number;
  unpublished: number;
  failures: Failure[];
  stopped: boolean;
};

export type Progress = { phase: "shipping" | "catalogues" | "publishing" | "inventory"; done: number; total: number };

const VARIANTS = `#graphql
  query MoveVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        variants(first: 250) {
          pageInfo { hasNextPage }
          nodes { id }
        }
      }
    }
  }
`;

const ASSOCIATE = `#graphql
  mutation MoveVariants($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      userErrors { field message }
    }
  }
`;

export const PUBLISH = `#graphql
  mutation MovePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

export const UNPUBLISH = `#graphql
  mutation MoveUnpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

/**
 * Shopify refuses a query whose REQUESTED cost is over 1,000: products x variants(first: 250) must stay under it.
 * 3 x 250 = 750 plus overhead. (5 x 250 was over the limit.)
 */
export const PRODUCTS_PER_READ = 3;
export const VARIANTS_PER_READ = 250;
const VARIANTS_PER_WRITE = 100;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function applyMove(
  plan: MovePlan,
  options: { onProgress: (p: Progress) => void; shouldStop: () => boolean },
): Promise<MoveResult> {
  const result: MoveResult = { succeeded: [], shippingMoved: 0, published: 0, unpublished: 0, failures: [], stopped: false };
  const profileId = plan.target.profile?.id;
  if (!profileId) throw new Error("The target has no shipping profile.");

  const failed = new Set<string>();
  const moved = new Set<string>();
  const fail = (productId: string, title: string, msg: string) => {
    failed.add(productId);
    result.failures.push({ productId, title, message: msg });
  };

  // ---- 1. Shipping profile --------------------------------------------
  const moving = plan.lines.filter((l) => l.shippingChange);
  let done = 0;
  options.onProgress({ phase: "shipping", done, total: moving.length });

  let batch: { productId: string; title: string }[] = [];
  let batchVariants: string[] = [];

  const flush = async () => {
    if (batchVariants.length === 0) return;
    const items = batch;
    const variants = batchVariants;
    batch = [];
    batchVariants = [];
    try {
      const data = await adminGraphql<{
        deliveryProfileUpdate: { userErrors: { field: string[] | null; message: string }[] };
      }>(ASSOCIATE, { id: profileId, profile: { variantsToAssociate: variants } });
      assertNoUserErrors(data.deliveryProfileUpdate.userErrors, "Moving variants");
      for (const i of items) moved.add(i.productId);
    } catch (err) {
      for (const i of items) fail(i.productId, i.title, message(err));
    }
  };

  for (let i = 0; i < moving.length; i += PRODUCTS_PER_READ) {
    if (options.shouldStop()) {
      result.stopped = true;
      break;
    }
    const chunk = moving.slice(i, i + PRODUCTS_PER_READ);
    try {
      const data = await adminGraphql<{
        nodes: ({
          id: string;
          variants: { pageInfo: { hasNextPage: boolean }; nodes: { id: string }[] };
        } | null)[];
      }>(VARIANTS, { ids: chunk.map((l) => l.product.id) });
      for (const line of chunk) {
        const node = data.nodes.find((n) => n?.id === line.product.id);
        const title = line.product.title;
        if (!node) fail(line.product.id, title, "Product not found. It may have been deleted.");
        else if (node.variants.pageInfo.hasNextPage) fail(line.product.id, title, "Has more than 250 variants. Move it in Shopify.");
        else if (node.variants.nodes.length === 0) fail(line.product.id, title, "Has no variants.");
        else {
          for (const v of node.variants.nodes) {
            batchVariants.push(v.id);
            if (batchVariants.length >= VARIANTS_PER_WRITE) {
              batch.push({ productId: line.product.id, title });
              await flush();
            }
          }
          if (batchVariants.length > 0) batch.push({ productId: line.product.id, title });
        }
      }
    } catch (err) {
      for (const line of chunk) fail(line.product.id, line.product.title, message(err));
    }
    done += chunk.length;
    options.onProgress({ phase: "shipping", done: Math.min(done, moving.length), total: moving.length });
  }
  await flush();
  result.shippingMoved = [...moved].filter((id) => !failed.has(id)).length;

  // A product goes on to the catalogues only when its shipping part is done (or it has none).
  const shippingOk = (l: (typeof plan.lines)[number]) =>
    !failed.has(l.product.id) && (!l.shippingChange || moved.has(l.product.id));
  const finished = new Set<string>(plan.lines.filter((l) => l.changes.length === 0 && shippingOk(l)).map((l) => l.product.id));

  // ---- 2. Catalogues ----------------------------------------------------
  const withChanges = plan.lines.filter((l) => l.changes.length > 0 && shippingOk(l));
  done = 0;
  options.onProgress({ phase: "catalogues", done, total: withChanges.length });

  for (const line of withChanges) {
    if (result.stopped || options.shouldStop()) {
      result.stopped = true;
      break;
    }
    const inputOf = (kind: "publish" | "unpublish") =>
      line.changes.filter((c) => c.kind === kind).map((c) => ({ publicationId: c.catalog.publicationId }));
    const publish = inputOf("publish");
    const unpublish = inputOf("unpublish");
    try {
      if (publish.length > 0) {
        const d = await adminGraphql<{ publishablePublish: { userErrors: { message: string }[] } }>(PUBLISH, {
          id: line.product.id,
          input: publish,
        });
        assertNoUserErrors(d.publishablePublish.userErrors, "Publishing");
        result.published += publish.length;
      }
      if (unpublish.length > 0) {
        const d = await adminGraphql<{ publishableUnpublish: { userErrors: { message: string }[] } }>(UNPUBLISH, {
          id: line.product.id,
          input: unpublish,
        });
        assertNoUserErrors(d.publishableUnpublish.userErrors, "Unpublishing");
        result.unpublished += unpublish.length;
      }
      finished.add(line.product.id);
    } catch (err) {
      fail(line.product.id, line.product.title, message(err));
    }
    done++;
    options.onProgress({ phase: "catalogues", done, total: withChanges.length });
  }
  result.succeeded = [...finished].filter((id) => !failed.has(id));
  return result;
}
