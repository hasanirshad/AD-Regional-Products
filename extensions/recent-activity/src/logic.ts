import { EVENTS_LIMIT } from "../../shared/constants";
import { plainText } from "../../shared/format";
import type { LoadContext } from "../../shared/graphql";

export type EventRow = { id: string; when: string; text: string; who: string };
export type Data = { updatedAt: string | null; events: EventRow[] };

type RawEvent = { id: string; createdAt: string; message?: string | null; action?: string | null; appTitle?: string | null; attributeToApp?: boolean; attributeToUser?: boolean };

const QUERY = `query RecentActivity($id: ID!, $first: Int!) {
  product(id: $id) {
    id
    updatedAt
    events(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes { id createdAt message action appTitle attributeToApp attributeToUser }
    }
  }
}`;

/** The API names the app, and says whether a staff member was involved. It never gives the staff member's name. */
export function whoDidIt(e: Pick<RawEvent, "appTitle" | "attributeToApp" | "attributeToUser">): string {
  const app = e.attributeToApp ? (e.appTitle?.trim() ? `App: ${e.appTitle.trim()}` : "An app") : "";
  if (app && e.attributeToUser) return `${app} (for a staff member)`;
  if (app) return app;
  if (e.attributeToUser) return "A staff member";
  return "Shopify";
}

export function shape(updatedAt: string | null, raw: RawEvent[]): Data {
  const events = raw
    .map((e) => ({ id: e.id, when: e.createdAt, text: plainText(e.message) || e.action || "Event", who: whoDidIt(e) }))
    .sort((a, b) => b.when.localeCompare(a.when));
  return { updatedAt, events };
}

export async function load({ productId, q }: LoadContext): Promise<Data> {
  const d = await q<{ product: { updatedAt: string; events: { nodes: RawEvent[] } } | null }>(QUERY, { id: productId, first: EVENTS_LIMIT });
  if (!d.product) throw new Error("Product not found");
  return shape(d.product.updatedAt, d.product.events.nodes);
}
