// What the editor saves, and where. The app has no database: everything it remembers lives INSIDE Shopify, in
// app-owned metafields (namespace "$app", which only this app can write):
//
//   on the app installation (one per store, shared by everyone who opens the app)
//     editor_sets       named choices of metafield rows ("Dining table content")
//     editor_bookmarks  products pinned in the picker
//     editor_undo       the last save, so it can be undone even after a reload
//     block_settings    the settings of the Product Insights blocks (written by the Settings page, read by the blocks)
//   on a draft product
//     draft_state       the step reached in "Create product" and the metafield rows chosen there
//
// Uninstalling the app deletes the installation metafields (the products and their drafts stay).
// Reading is free. Saving is a mutation, so it asks for the password like every other write.

import { parseSettings, SETTINGS_KEY as BLOCKS_KEY, type ParseResult } from "../../../extensions/shared/settings";
import { formatUserErrors, type Gql, type UserError } from "./gql";
import type { Change, Target, Value } from "./model";

export const NAMESPACE = "$app";
export const SETS_KEY = "editor_sets";
export const BOOKMARKS_KEY = "editor_bookmarks";
export const UNDO_KEY = "editor_undo";
export const DRAFT_KEY = "draft_state";

/** A metafield value may hold about 2 MB of JSON. The undo record stays well under it, or is not saved. */
export const MAX_UNDO_CHARS = 1_500_000;

export type SavedSet = {
  id: string;
  name: string;
  /** Product metafields, as "namespace.key". */
  product: string[];
  /** Variant metafields, as "namespace.key". */
  variant: string[];
};

export type Bookmark = { id: string; title: string; handle: string };

export type UndoItem = { target: Target; productId: string; productTitle: string; label: string; before: Value; after: Value };

export type UndoRecord = {
  /** ISO time of the save. */
  at: string;
  /** What was saved, for the button label. */
  action: string;
  /** The changes Shopify accepted. Undo puts every one back to `before`. */
  items: UndoItem[];
};

export type CreateStep = "basics" | "seo" | "metafields" | "variants" | "type" | "tags" | "prices";
export const CREATE_STEPS: { id: CreateStep; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "seo", label: "SEO" },
  { id: "metafields", label: "Metafields" },
  { id: "variants", label: "Variants" },
  { id: "type", label: "Type" },
  { id: "tags", label: "Tags" },
  { id: "prices", label: "Prices" },
];

export type DraftState = {
  step: CreateStep;
  product: string[];
  variant: string[];
  savedAt: string;
};

// ---------------------------------------------------------------- parse and serialize (pure)

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseSets(raw: string | null | undefined): SavedSet[] {
  const data = parseJson(raw) as { sets?: unknown } | null;
  if (!data || !Array.isArray(data.sets)) return [];
  const out: SavedSet[] = [];
  const seen = new Set<string>();
  for (const s of data.sets as Record<string, unknown>[]) {
    if (typeof s?.id !== "string" || typeof s.name !== "string" || !s.name.trim() || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, name: s.name.trim(), product: strings(s.product), variant: strings(s.variant) });
  }
  return out;
}

export const serializeSets = (sets: SavedSet[]): string => JSON.stringify({ version: 1, sets });

export function parseBookmarks(raw: string | null | undefined): Bookmark[] {
  const data = parseJson(raw) as { items?: unknown } | null;
  if (!data || !Array.isArray(data.items)) return [];
  return (data.items as Record<string, unknown>[]).flatMap((b) =>
    typeof b?.id === "string" && typeof b.title === "string" ? [{ id: b.id, title: b.title, handle: typeof b.handle === "string" ? b.handle : "" }] : [],
  );
}

export const serializeBookmarks = (items: Bookmark[]): string => JSON.stringify({ version: 1, items });

export function parseUndo(raw: string | null | undefined): UndoRecord | null {
  const data = parseJson(raw) as { at?: unknown; action?: unknown; items?: unknown } | null;
  if (!data || typeof data.at !== "string" || !Array.isArray(data.items)) return null;
  const items = (data.items as UndoItem[]).filter((i) => i && typeof i.productId === "string" && i.target && typeof i.target === "object");
  if (items.length === 0) return null;
  return { at: data.at, action: typeof data.action === "string" ? data.action : "Last save", items };
}

export function undoRecordFrom(action: string, changes: Change[], at: Date = new Date()): UndoRecord {
  return {
    at: at.toISOString(),
    action,
    items: changes.map((c) => ({ target: c.target, productId: c.productId, productTitle: c.productTitle, label: c.label, before: c.before, after: c.after })),
  };
}

/** The text to save, or null when the record is too big for a metafield (it then lives in memory only). */
export function serializeUndo(record: UndoRecord): string | null {
  const text = JSON.stringify({ version: 1, ...record });
  return text.length > MAX_UNDO_CHARS ? null : text;
}

export function parseDraftState(raw: string | null | undefined): DraftState | null {
  const data = parseJson(raw) as Record<string, unknown> | null;
  if (!data) return null;
  const step = CREATE_STEPS.find((s) => s.id === data.step)?.id;
  if (!step) return null;
  return { step, product: strings(data.product), variant: strings(data.variant), savedAt: typeof data.savedAt === "string" ? data.savedAt : "" };
}

export const serializeDraftState = (d: DraftState): string => JSON.stringify({ version: 1, ...d });

export function newId(prefix = "s"): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------- reading

export const SETTINGS_QUERY = `#graphql
  query EditorSettings {
    currentAppInstallation {
      id
      sets: metafield(namespace: "${NAMESPACE}", key: "${SETS_KEY}") { value }
      bookmarks: metafield(namespace: "${NAMESPACE}", key: "${BOOKMARKS_KEY}") { value }
      undo: metafield(namespace: "${NAMESPACE}", key: "${UNDO_KEY}") { value }
      blocks: metafield(namespace: "${NAMESPACE}", key: "${BLOCKS_KEY}") { value }
    }
  }`;

export type Settings = {
  installationId: string;
  sets: SavedSet[];
  bookmarks: Bookmark[];
  undo: UndoRecord | null;
  /** The settings of the Product Insights blocks, checked (a broken value gives the defaults). */
  blocks: ParseResult;
  /** The stored text, to notice when someone else saved. */
  blocksRaw: string | null;
};

export async function loadSettings(gql: Gql): Promise<Settings> {
  const data = await gql<{
    currentAppInstallation: { id: string; sets: { value: string } | null; bookmarks: { value: string } | null; undo: { value: string } | null; blocks?: { value: string } | null };
  }>(SETTINGS_QUERY);
  const i = data.currentAppInstallation;
  const blocksRaw = i.blocks?.value ?? null;
  return { installationId: i.id, sets: parseSets(i.sets?.value), bookmarks: parseBookmarks(i.bookmarks?.value), undo: parseUndo(i.undo?.value), blocks: parseSettings(blocksRaw), blocksRaw };
}

// ---------------------------------------------------------------- writing (needs the password)

export const SAVE_SETTING = `#graphql
  mutation EditorSaveSetting($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }`;

export const DELETE_SETTING = `#graphql
  mutation EditorDeleteSetting($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      userErrors { field message }
    }
  }`;

async function save(gql: Gql, ownerId: string, key: string, value: string): Promise<void> {
  const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(SAVE_SETTING, {
    metafields: [{ ownerId, namespace: NAMESPACE, key, type: "json", value }],
  });
  const message = formatUserErrors(data.metafieldsSet.userErrors);
  if (message) throw new Error(message);
}

export const saveSets = (gql: Gql, installationId: string, sets: SavedSet[]) => save(gql, installationId, SETS_KEY, serializeSets(sets));
export const saveBookmarks = (gql: Gql, installationId: string, items: Bookmark[]) => save(gql, installationId, BOOKMARKS_KEY, serializeBookmarks(items));

/** Saves the undo record. Returns false when it is too big to store (Undo then works until the page is reloaded). */
export async function saveUndo(gql: Gql, installationId: string, record: UndoRecord): Promise<boolean> {
  const text = serializeUndo(record);
  if (text === null) return false;
  await save(gql, installationId, UNDO_KEY, text);
  return true;
}

export async function clearUndo(gql: Gql, installationId: string): Promise<void> {
  const data = await gql<{ metafieldsDelete: { userErrors: UserError[] } }>(DELETE_SETTING, {
    metafields: [{ ownerId: installationId, namespace: NAMESPACE, key: UNDO_KEY }],
  });
  const message = formatUserErrors(data.metafieldsDelete.userErrors);
  if (message) throw new Error(message);
}

export const saveDraftState = (gql: Gql, productId: string, state: DraftState) => save(gql, productId, DRAFT_KEY, serializeDraftState(state));

// ---------------------------------------------------------------- unfinished drafts

export const DRAFTS_QUERY = `#graphql
  query EditorDrafts($after: String) {
    products(first: 50, after: $after, query: "status:draft", sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        updatedAt
        state: metafield(namespace: "${NAMESPACE}", key: "${DRAFT_KEY}") { value }
      }
    }
  }`;

export type UnfinishedDraft = { id: string; title: string; handle: string; updatedAt: string; state: DraftState };

/** Draft products that were started in this editor and not finished (they carry a draft_state metafield). */
export async function listDrafts(gql: Gql): Promise<UnfinishedDraft[]> {
  const out: UnfinishedDraft[] = [];
  let after: string | null = null;
  for (let page = 0; page < 4; page++) {
    const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; title: string; handle: string; updatedAt: string; state: { value: string } | null }[] } } = await gql(DRAFTS_QUERY, { after });
    for (const n of data.products.nodes) {
      const state = parseDraftState(n.state?.value);
      if (state) out.push({ id: n.id, title: n.title, handle: n.handle, updatedAt: n.updatedAt, state });
    }
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }
  return out;
}
