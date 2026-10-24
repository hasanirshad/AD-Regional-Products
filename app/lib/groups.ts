// Group definitions: what the app saves in its one app metafield, and the
// rules a group must follow before it can be saved.

import type { Group, GroupsFile } from "./types";

export const GROUPS_KEY = "groups";
export const EMPTY_GROUPS: GroupsFile = { version: 1, groups: [] };

export function profileNameFor(groupName: string): string {
  return `Group: ${groupName.trim()}`;
}

export function newGroupId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Tolerant reader: bad or missing data gives an empty list, never a crash. */
export function parseGroupsFile(raw: unknown): GroupsFile {
  if (!raw || typeof raw !== "object") return { version: 1, groups: [] };
  const list = (raw as { groups?: unknown }).groups;
  if (!Array.isArray(list)) return { version: 1, groups: [] };
  const groups: Group[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    if (typeof g.id !== "string" || typeof g.name !== "string") continue;
    const countries = Array.isArray(g.countries)
      ? g.countries.filter((c): c is string => typeof c === "string").map((c) => c.toUpperCase())
      : [];
    groups.push({
      id: g.id,
      name: g.name,
      countries: [...new Set(countries)],
      profileId: typeof g.profileId === "string" ? g.profileId : null,
    });
  }
  return { version: 1, groups };
}

export type Draft = { id: string | null; name: string; countries: string[] };

/** Returns the reason a draft cannot be saved yet, or null when it can. */
export function validateDraft(draft: Draft, existing: Group[]): string | null {
  const name = draft.name.trim();
  if (!name) return "Enter a group name.";
  if (name.length > 60) return "Use a shorter group name (60 characters at most).";
  const clash = existing.some(
    (g) => g.id !== draft.id && g.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) return "Another group already uses this name.";
  if (draft.countries.length === 0) return "Choose at least one country.";
  return null;
}
