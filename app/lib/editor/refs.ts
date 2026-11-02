// Pickers for the references Shopify's own picker does not cover here: metaobject entries and files. Reads only.
// A metafield definition names the kind of metaobject it holds (a validation with the definition id) and, for files, the
// kinds of file it accepts. The lists are read in pages and searched on screen, so no search syntax has to be right.
// Uploading new files is not part of this app: a file has to be in the store's Files already.

import { chunks, type Gql } from "./gql";
import type { Validation } from "./mfRules";

export type PickKind = "image" | "video" | "file" | "entry";
export type PickItem = { id: string; label: string; detail: string; thumb: string | null; kind: PickKind };

/** The id of the metaobject definition a reference metafield points at (none for a mixed reference). */
export function metaobjectDefinitionId(validations: Validation[]): string | null {
  return validations.find((v) => v.name === "metaobject_definition_id")?.value ?? null;
}

/** The kinds of file a file metafield accepts. No rule means any kind. */
export function acceptedFileKinds(validations: Validation[]): PickKind[] {
  const raw = validations.find((v) => v.name === "file_type_options")?.value;
  if (!raw) return ["image", "video", "file"];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return ["image", "video", "file"];
  }
  if (!Array.isArray(list)) return ["image", "video", "file"];
  const kinds = new Set<PickKind>();
  for (const x of list) {
    const t = String(x).toLowerCase();
    if (t === "image") kinds.add("image");
    else if (t === "video") kinds.add("video");
    else if (t === "genericfile" || t === "generic_file" || t === "file") kinds.add("file");
  }
  return kinds.size ? [...kinds] : ["image", "video", "file"];
}

export const KIND_WORD: Record<PickKind, string> = { image: "Image", video: "Video", file: "Document", entry: "Entry" };

/** "…/files/oak-top.jpg?v=123" -> "oak-top.jpg" */
export function fileNameOf(url: string | null | undefined): string {
  if (!url) return "";
  const path = url.split("?")[0] ?? "";
  const last = path.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// ---------------------------------------------------------------- metaobject entries

export const METAOBJECT_DEFINITION_QUERY = `#graphql
  query EditorMetaobjectDefinition($id: ID!) {
    metaobjectDefinition(id: $id) { id type name }
  }`;

export const METAOBJECTS_QUERY = `#graphql
  query EditorMetaobjects($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id displayName handle }
    }
  }`;

export async function loadMetaobjectType(gql: Gql, definitionId: string): Promise<{ type: string; name: string } | null> {
  const data = await gql<{ metaobjectDefinition: { type: string; name: string } | null }>(METAOBJECT_DEFINITION_QUERY, { id: definitionId });
  return data.metaobjectDefinition ? { type: data.metaobjectDefinition.type, name: data.metaobjectDefinition.name } : null;
}

export type Page = { items: PickItem[]; next: string | null };

export async function loadMetaobjectPage(gql: Gql, type: string, after: string | null = null): Promise<Page> {
  const data = await gql<{ metaobjects: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; displayName: string | null; handle: string }[] } }>(METAOBJECTS_QUERY, { type, first: 50, after });
  return {
    items: data.metaobjects.nodes.map((n) => ({ id: n.id, label: n.displayName || n.handle, detail: n.handle, thumb: null, kind: "entry" as const })),
    next: data.metaobjects.pageInfo.hasNextPage ? data.metaobjects.pageInfo.endCursor : null,
  };
}

// ---------------------------------------------------------------- files

export const FILES_QUERY = `#graphql
  query EditorFiles($first: Int!, $after: String) {
    files(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        __typename
        id
        alt
        ... on MediaImage { image { url } }
        ... on GenericFile { url mimeType }
        ... on Video { filename }
      }
    }
  }`;

type RawFile = { __typename: string; id: string; alt?: string | null; image?: { url: string } | null; url?: string | null; mimeType?: string | null; filename?: string | null };

export function fileItem(n: RawFile): PickItem {
  const kind: PickKind = n.__typename === "MediaImage" ? "image" : n.__typename === "Video" || n.__typename === "ExternalVideo" ? "video" : "file";
  const name = n.__typename === "MediaImage" ? fileNameOf(n.image?.url) : n.__typename === "Video" ? (n.filename ?? "") : fileNameOf(n.url);
  return { id: n.id, label: name || n.alt || n.id, detail: n.alt && n.alt !== name ? n.alt : n.mimeType ?? KIND_WORD[kind], thumb: kind === "image" ? (n.image?.url ?? null) : null, kind };
}

export async function loadFilePage(gql: Gql, after: string | null = null): Promise<Page> {
  const data = await gql<{ files: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawFile[] } }>(FILES_QUERY, { first: 50, after });
  return { items: data.files.nodes.map(fileItem), next: data.files.pageInfo.hasNextPage ? data.files.pageInfo.endCursor : null };
}

/** Keeps the items that match the typed words (every word, anywhere in the name or detail) and the kinds accepted. */
export function filterItems(items: PickItem[], text: string, kinds: PickKind[] | null): PickItem[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => (!kinds || kinds.includes(i.kind)) && words.every((w) => `${i.label} ${i.detail}`.toLowerCase().includes(w)));
}

// ---------------------------------------------------------------- names for ids already saved

export const METAOBJECT_LABELS_QUERY = `#graphql
  query EditorMetaobjectLabels($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Metaobject { id displayName handle } }
  }`;

export const FILE_LABELS_QUERY = `#graphql
  query EditorFileLabels($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on MediaImage { id alt image { url } }
      ... on GenericFile { id alt url mimeType }
      ... on Video { id alt filename }
    }
  }`;

/**
 * Names for metaobject and file ids. Each kind is asked for separately and a failure (for example a scope that is not
 * granted yet) leaves that kind without names rather than failing the others: the id then shows in short form.
 */
export async function loadPickLabels(gql: Gql, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(ids)];
  const entries = unique.filter((id) => id.includes("/Metaobject/"));
  const files = unique.filter((id) => /\/(MediaImage|Video|GenericFile|ExternalVideo)\//.test(id));
  for (const group of chunks(entries, 50)) {
    try {
      const data = await gql<{ nodes: ({ id?: string; displayName?: string | null; handle?: string } | null)[] }>(METAOBJECT_LABELS_QUERY, { ids: group });
      for (const n of data.nodes) if (n?.id) out[n.id] = n.displayName || n.handle || n.id;
    } catch {
      /* names are a nicety */
    }
  }
  for (const group of chunks(files, 50)) {
    try {
      const data = await gql<{ nodes: (RawFile | null)[] }>(FILE_LABELS_QUERY, { ids: group });
      for (const n of data.nodes) if (n?.id) out[n.id] = fileItem(n).label;
    } catch {
      /* names are a nicety */
    }
  }
  return out;
}
