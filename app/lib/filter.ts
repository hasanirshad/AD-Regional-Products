// Search and filters for the product list. Pure functions, no network.

import type { Filters, Group, Membership, ProductRow } from "./types";

export const NONE = "__none__";
export const ANY = "__any__";

export const NO_FILTERS: Filters = {
  search: "",
  status: "",
  vendor: "",
  productType: "",
  tag: "",
  catalog: "",
  group: "",
};

export function applyFilters(rows: ProductRow[], f: Filters, membership: Membership): ProductRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((p) => {
    if (q) {
      const hay = [p.title, p.handle, p.vendor, p.productType, ...p.tags].join("\n").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.status && p.status !== f.status) return false;
    if (f.vendor && p.vendor !== f.vendor) return false;
    if (f.productType && p.productType !== f.productType) return false;
    if (f.tag && !p.tags.includes(f.tag)) return false;
    if (f.catalog === NONE && p.catalogs.length > 0) return false;
    if (f.catalog === ANY && p.catalogs.length === 0) return false;
    if (f.catalog && f.catalog !== NONE && f.catalog !== ANY && !p.catalogs.some((c) => c.id === f.catalog)) {
      return false;
    }
    const groupId = membership[p.id];
    if (f.group === NONE && groupId) return false;
    if (f.group && f.group !== NONE && groupId !== f.group) return false;
    return true;
  });
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function filterOptions(rows: ProductRow[]) {
  const catalogs = new Map<string, string>();
  for (const p of rows) for (const c of p.catalogs) catalogs.set(c.id, c.title);
  return {
    vendors: sortedUnique(rows.map((p) => p.vendor)),
    types: sortedUnique(rows.map((p) => p.productType)),
    tags: sortedUnique(rows.flatMap((p) => p.tags)),
    statuses: sortedUnique(rows.map((p) => p.status)),
    catalogs: [...catalogs.entries()]
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export type Chip = { key: keyof Filters; label: string };

/** One removable chip per active filter (the search text has its own field). */
export function activeChips(
  f: Filters,
  lookups: { catalogs: { id: string; title: string }[]; groups: Group[] },
): Chip[] {
  const chips: Chip[] = [];
  if (f.status) chips.push({ key: "status", label: `Status: ${f.status.toLowerCase()}` });
  if (f.vendor) chips.push({ key: "vendor", label: `Vendor: ${f.vendor}` });
  if (f.productType) chips.push({ key: "productType", label: `Type: ${f.productType}` });
  if (f.tag) chips.push({ key: "tag", label: `Tag: ${f.tag}` });
  if (f.catalog) {
    const label =
      f.catalog === NONE
        ? "Not in any catalogue"
        : f.catalog === ANY
          ? "In any catalogue"
          : `Catalogue: ${lookups.catalogs.find((c) => c.id === f.catalog)?.title ?? "unknown"}`;
    chips.push({ key: "catalog", label });
  }
  if (f.group) {
    const label =
      f.group === NONE
        ? "Not in a group"
        : `Group: ${lookups.groups.find((g) => g.id === f.group)?.name ?? "unknown"}`;
    chips.push({ key: "group", label });
  }
  return chips;
}
