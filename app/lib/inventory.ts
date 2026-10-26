// Bulk stock settings: turn on "track quantity", stop selling at zero, and set a quantity at one location, for every
// variant of the chosen products. Same safe shape as the channel change: plan (pure) -> recheck -> apply -> read back.
// Writes happen only here, and only from a screen that asked for the password.

import { adminGraphql, assertNoUserErrors } from "./admin";
import type { RunEngine, RunHooks } from "./engine";
import type { Finding } from "./readback";
import type { ReportRow } from "./report";
import type { ProductRow } from "./types";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type StockLocation = { id: string; name: string };

export type VariantStock = {
  id: string;
  title: string;
  sku: string;
  itemId: string;
  tracked: boolean;
  /** DENY = stops selling at zero. CONTINUE = keeps selling at zero. */
  policy: "DENY" | "CONTINUE";
  /** Every location the variant is stocked at, with the available quantity there. */
  levels: StockLevel[];
};

export type StockLevel = { id: string; locationId: string; name: string; quantity: number };

/** Available quantity at a location. null = the variant is not stocked there. */
export const qtyAt = (v: VariantStock, locationId: string): number | null => v.levels.find((l) => l.locationId === locationId)?.quantity ?? null;

export type ProductStock = { id: string; status: string; variants: VariantStock[]; complete: boolean };

export type StockSettings = {
  track: boolean;
  /** Stop selling when sold out. */
  stopAtZero: boolean;
  setQuantity: boolean;
  quantity: number;
  /** The ticked locations: where the quantity is set, and the only ones kept when `onlyHere` is on. */
  locations: StockLocation[];
  /** Take the variants out of every location that is not ticked. */
  onlyHere: boolean;
};

/**
 * `setAt` = the ticked locations where this variant gets the quantity (it is stocked there and differs).
 * `remove` = the locations it is taken out of (only with `onlyHere`).
 */
export type VariantChange = { variant: VariantStock; track: boolean; policy: boolean; setAt: string[]; remove: StockLevel[] };

export type StockLine = {
  product: ProductRow;
  /** Every variant as read when the plan was built (to spot changes before Apply). */
  before: VariantStock[];
  changes: VariantChange[];
  /** Places (variant x location) that could not get a quantity because the variant is not stocked there. */
  notStocked: number;
};

export type StockPlan = {
  lines: StockLine[];
  unchanged: ProductRow[];
  skipped: { product: ProductRow; reason: string }[];
  settings: StockSettings;
  totals: { variants: number; track: number; policy: number; quantity: number; lowered: number; notStocked: number; remove: number; removedStock: number; keptAll: number };
  blocker: string | null;
  warnings: string[];
};

// ---------------------------------------------------------------- reading

const STOCK = `#graphql
  query InventoryStock($ids: [ID!]!, $first: Int!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        status
        variants(first: $first) {
          pageInfo { hasNextPage }
          nodes {
            id
            title
            sku
            inventoryPolicy
            inventoryItem {
              id
              tracked
              inventoryLevels(first: 8) {
                pageInfo { hasNextPage }
                nodes {
                  id
                  location { id name }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  }`;

const LOCATIONS = `#graphql
  query StockLocations {
    locations(first: 50) { nodes { id name } }
  }`;

type RawProduct = {
  id: string;
  status: string;
  variants: {
    pageInfo: { hasNextPage: boolean };
    nodes: {
      id: string;
      title: string;
      sku?: string | null;
      inventoryPolicy: string;
      inventoryItem?: {
        id: string;
        tracked: boolean;
        inventoryLevels?: {
          pageInfo?: { hasNextPage: boolean };
          nodes: { id: string; location: { id: string; name: string }; quantities: { name: string; quantity: number }[] }[];
        } | null;
      } | null;
    }[];
  };
} | null;

export function parseStock(raw: NonNullable<RawProduct>): ProductStock {
  const cutLevels = raw.variants.nodes.some((v) => v.inventoryItem?.inventoryLevels?.pageInfo?.hasNextPage);
  return {
    id: raw.id,
    status: raw.status,
    complete: !raw.variants.pageInfo.hasNextPage && !cutLevels,
    variants: raw.variants.nodes.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku ?? "",
      itemId: v.inventoryItem?.id ?? "",
      tracked: v.inventoryItem?.tracked ?? false,
      policy: v.inventoryPolicy === "DENY" ? "DENY" : "CONTINUE",
      levels: (v.inventoryItem?.inventoryLevels?.nodes ?? []).map((l) => ({
        id: l.id,
        locationId: l.location.id,
        name: l.location.name,
        quantity: l.quantities.find((q) => q.name === "available")?.quantity ?? 0,
      })),
    })),
  };
}

export async function loadStockLocations(): Promise<StockLocation[]> {
  const d = await adminGraphql<{ locations: { nodes: StockLocation[] } }>(LOCATIONS);
  return d.locations.nodes.map((l) => ({ id: l.id, name: l.name }));
}

const CHUNK = 2;
const FIRST = 25;
const FIRST_ALONE = 50;

/** Reads every variant of each product with all the locations it is stocked at. Missing = not found. Big products are read alone. */
export async function readStock(ids: string[]): Promise<Record<string, ProductStock>> {
  const out: Record<string, ProductStock> = {};
  const again: string[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const d = await adminGraphql<{ nodes: RawProduct[] }>(STOCK, { ids: ids.slice(i, i + CHUNK), first: FIRST });
    for (const n of d.nodes) {
      if (!n) continue;
      const p = parseStock(n);
      if (p.complete) out[n.id] = p;
      else again.push(n.id);
    }
  }
  for (const id of again) {
    const d = await adminGraphql<{ nodes: RawProduct[] }>(STOCK, { ids: [id], first: FIRST_ALONE });
    const n = d.nodes[0];
    if (n) out[n.id] = parseStock(n);
  }
  return out;
}

// ---------------------------------------------------------------- overview (read only, every location)

/** What a product looks like now, over all its variants: shown next to the product on the Inventory page. */
export type StockSummary = {
  id: string;
  variants: number;
  /** false = the product has more variants than were read. */
  complete: boolean;
  tracked: number;
  /** Variants that stop selling at 0 (policy DENY). */
  stops: number;
  /** Every location where at least one variant is stocked, with the available total over the variants stocked there. */
  locations: { id: string; name: string; available: number; variants: number }[];
};

const OVERVIEW = `#graphql
  query InventoryOverview($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        variants(first: 40) {
          pageInfo { hasNextPage }
          nodes {
            inventoryPolicy
            inventoryItem {
              tracked
              inventoryLevels(first: 8) {
                nodes {
                  location { id name }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  }`;

type RawOverview = {
  id: string;
  variants: {
    pageInfo: { hasNextPage: boolean };
    nodes: {
      inventoryPolicy: string;
      inventoryItem?: {
        tracked: boolean;
        inventoryLevels?: { nodes: { location: { id: string; name: string }; quantities: { name: string; quantity: number }[] }[] } | null;
      } | null;
    }[];
  };
} | null;

export function summarizeStock(raw: NonNullable<RawOverview>): StockSummary {
  const byLocation = new Map<string, StockSummary["locations"][number]>();
  let tracked = 0;
  let stops = 0;
  for (const v of raw.variants.nodes) {
    if (v.inventoryItem?.tracked) tracked++;
    if (v.inventoryPolicy === "DENY") stops++;
    for (const level of v.inventoryItem?.inventoryLevels?.nodes ?? []) {
      const q = level.quantities.find((x) => x.name === "available")?.quantity ?? 0;
      const cur = byLocation.get(level.location.id) ?? { id: level.location.id, name: level.location.name, available: 0, variants: 0 };
      cur.available += q;
      cur.variants++;
      byLocation.set(level.location.id, cur);
    }
  }
  return {
    id: raw.id,
    variants: raw.variants.nodes.length,
    complete: !raw.variants.pageInfo.hasNextPage,
    tracked,
    stops,
    locations: [...byLocation.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Reads the current stock picture of products (all locations). Two products per read keeps each read cheap. */
export async function readStockOverview(ids: string[]): Promise<Record<string, StockSummary>> {
  const out: Record<string, StockSummary> = {};
  for (let i = 0; i < ids.length; i += 2) {
    const d = await adminGraphql<{ nodes: RawOverview[] }>(OVERVIEW, { ids: ids.slice(i, i + 2) });
    for (const n of d.nodes) if (n) out[n.id] = summarizeStock(n);
  }
  return out;
}

// ---------------------------------------------------------------- plan (pure)

export function settingsProblem(s: StockSettings): string | null {
  if (!s.track && !s.stopAtZero && !s.setQuantity && !s.onlyHere) return "Choose at least one change.";
  if (s.setQuantity) {
    if (!Number.isInteger(s.quantity) || s.quantity < 0) return "The quantity must be a whole number, 0 or more.";
    if (s.quantity > 1_000_000) return "The quantity is too large.";
  }
  if ((s.setQuantity || s.onlyHere) && s.locations.length === 0) return "Tick at least one location.";
  return null;
}

export function planStock(input: {
  products: ProductRow[];
  states: Record<string, ProductStock>;
  settings: StockSettings;
}): StockPlan {
  const { settings } = input;
  const lines: StockLine[] = [];
  const unchanged: ProductRow[] = [];
  const skipped: StockPlan["skipped"] = [];
  const totals = { variants: 0, track: 0, policy: 0, quantity: 0, lowered: 0, notStocked: 0, remove: 0, removedStock: 0, keptAll: 0 };

  for (const product of input.products) {
    const s = input.states[product.id];
    if (!s) {
      skipped.push({ product, reason: "Not found. It may have been deleted." });
      continue;
    }
    if (!s.complete) {
      skipped.push({ product, reason: "Has too many variants to read safely. Change it in Shopify." });
      continue;
    }
    if (s.variants.length === 0) {
      skipped.push({ product, reason: "Has no variants." });
      continue;
    }
    const changes: VariantChange[] = [];
    let notStocked = 0;
    for (const v of s.variants) {
      const track = settings.track && !v.tracked;
      const policy = settings.stopAtZero && v.policy !== "DENY";
      const setAt: string[] = [];
      if (settings.setQuantity) {
        for (const loc of settings.locations) {
          const q = qtyAt(v, loc.id);
          if (q === null) notStocked++;
          else if (q !== settings.quantity) {
            setAt.push(loc.id);
            if (q > settings.quantity) totals.lowered++;
          }
        }
      }
      // "Only here": leave the ticked locations and drop the rest, but never from a variant that is not stocked at a ticked
      // location (it would be left with nowhere to be stocked).
      let remove: StockLevel[] = [];
      if (settings.onlyHere && settings.locations.length > 0) {
        const keep = new Set(settings.locations.map((x) => x.id));
        if (settings.locations.every((loc) => qtyAt(v, loc.id) !== null)) remove = v.levels.filter((l) => !keep.has(l.locationId));
        else totals.keptAll++;
      }
      if (track || policy || setAt.length > 0 || remove.length > 0) {
        changes.push({ variant: v, track, policy, setAt, remove });
        totals.remove += remove.length;
        totals.removedStock += remove.filter((l) => l.quantity > 0).length;
        if (track) totals.track++;
        if (policy) totals.policy++;
        totals.quantity += setAt.length;
      }
    }
    totals.variants += s.variants.length;
    totals.notStocked += notStocked;
    if (changes.length === 0) unchanged.push(product);
    else lines.push({ product, before: s.variants, changes, notStocked });
  }

  const warnings: string[] = [];
  if (totals.lowered > 0) warnings.push(`${totals.lowered} stock level${totals.lowered === 1 ? " is" : "s are"} currently higher than ${settings.quantity}. They will be lowered.`);
  if (totals.notStocked > 0) {
    warnings.push(
      `${totals.notStocked} variant-location pair${totals.notStocked === 1 ? " is" : "s are"} not stocked (the variant is not stocked at that location). They get no quantity: add the location to the variant in Shopify first.`,
    );
  }
  if (totals.keptAll > 0) {
    warnings.push(
      `${totals.keptAll} variant${totals.keptAll === 1 ? " is" : "s are"} not stocked at every ticked location, so they keep their other locations (a variant must stay stocked somewhere).`,
    );
  }
  if (totals.removedStock > 0) {
    warnings.push(`${totals.removedStock} location${totals.removedStock === 1 ? "" : "s"} to be removed still hold stock. That stock count is lost when the location is removed.`);
  }
  return { lines, unchanged, skipped, settings, totals, blocker: settingsProblem(settings), warnings };
}

/** One short line describing a product's variants, for the report. */
export function describeStock(variants: VariantStock[]): string {
  const n = variants.length;
  const tracked = variants.filter((v) => v.tracked).length;
  const stops = variants.filter((v) => v.policy === "DENY").length;
  const names = new Map<string, string>();
  for (const v of variants) for (const l of v.levels) names.set(l.locationId, l.name);
  const at = [...names.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => {
      const qty = variants.map((v) => String(qtyAt(v, id) ?? "–"));
      return `${name} ${qty.length > 8 ? `${qty.slice(0, 8).join(", ")}, …` : qty.join(", ")}`;
    });
  return `tracked ${tracked}/${n} · stops at 0: ${stops}/${n}${at.length ? ` · stock: ${at.join(" | ")}` : " · stocked nowhere"}`;
}

export function changeLabels(l: StockLine, s: StockSettings): string[] {
  const out: string[] = [];
  const t = l.changes.filter((c) => c.track).length;
  const p = l.changes.filter((c) => c.policy).length;
  const q = l.changes.reduce((n, c) => n + c.setAt.length, 0);
  if (t) out.push(`Track quantity: ${t} variant${t === 1 ? "" : "s"}`);
  if (p) out.push(`Stop selling at 0: ${p} variant${p === 1 ? "" : "s"}`);
  if (q) out.push(`Quantity set to ${s.quantity}: ${q} stock level${q === 1 ? "" : "s"}`);
  const r = l.changes.reduce((n, c) => n + c.remove.length, 0);
  if (r) out.push(`Remove other locations: ${r}`);
  return out;
}

// ---------------------------------------------------------------- checks

const sameVariant = (a: VariantStock, b: VariantStock) =>
  a.tracked === b.tracked &&
  a.policy === b.policy &&
  a.levels.length === b.levels.length &&
  a.levels.every((l) => qtyAt(b, l.locationId) === l.quantity);

/** BEFORE Apply: has any product changed since the review was built? */
export function findStockDrift(lines: StockLine[], state: Record<string, ProductStock>): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const s = state[l.product.id];
    const title = l.product.title;
    if (!s) {
      out.push({ productId: l.product.id, title, message: "Product not found. It may have been deleted." });
      continue;
    }
    const now = new Map(s.variants.map((v) => [v.id, v]));
    const changed = s.variants.length !== l.before.length || l.before.some((b) => !now.has(b.id) || !sameVariant(b, now.get(b.id)!));
    if (changed) out.push({ productId: l.product.id, title, message: "Its stock settings changed since the review." });
  }
  return out;
}

/** AFTER Apply: does Shopify show what was asked? Empty = yes. */
export function findStockMismatch(lines: StockLine[], settings: StockSettings, state: Record<string, ProductStock>): Finding[] {
  const out: Finding[] = [];
  for (const l of lines) {
    const s = state[l.product.id];
    const title = l.product.title;
    if (!s) {
      out.push({ productId: l.product.id, title, message: "Could not read the product back." });
      continue;
    }
    const now = new Map(s.variants.map((v) => [v.id, v]));
    for (const c of l.changes) {
      const v = now.get(c.variant.id);
      const name = c.variant.title || c.variant.sku || c.variant.id;
      if (!v) out.push({ productId: l.product.id, title, message: `Variant ${name} was not found after the change.` });
      else if (c.track && !v.tracked) out.push({ productId: l.product.id, title, message: `Variant ${name} is still not tracked.` });
      else if (c.policy && v.policy !== "DENY") out.push({ productId: l.product.id, title, message: `Variant ${name} still keeps selling at 0.` });
      else {
        for (const id of c.setAt) {
          const q = qtyAt(v, id);
          if (q !== settings.quantity) {
            const where = settings.locations.find((x) => x.id === id)?.name ?? "the location";
            out.push({ productId: l.product.id, title, message: `Variant ${name} shows ${q ?? "no"} in stock at ${where}, not ${settings.quantity}.` });
            break;
          }
        }
        for (const gone of c.remove) {
          if (qtyAt(v, gone.locationId) !== null) {
            out.push({ productId: l.product.id, title, message: `Variant ${name} is still stocked at ${gone.name}.` });
            break;
          }
        }
      }
    }
  }
  return out;
}

export async function recheckStock(lines: StockLine[], settings: StockSettings): Promise<Finding[]> {
  return findStockDrift(lines, await readStock(lines.map((l) => l.product.id)));
}

// ---------------------------------------------------------------- writes

const UPDATE_VARIANTS = `#graphql
  mutation StockVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }`;

const SET_QUANTITIES = `#graphql
  mutation StockQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }`;

const DEACTIVATE = `#graphql
  mutation StockRemoveLocation($id: ID!) {
    inventoryDeactivate(inventoryLevelId: $id) {
      userErrors { message }
    }
  }`;

const BATCH = 250;

type Applied = { succeeded: string[]; failures: Map<string, string>; stopped: boolean };

async function applyLines(lines: StockLine[], settings: StockSettings, hooks: Pick<RunHooks, "onProgress" | "shouldStop">): Promise<Applied> {
  const out: Applied = { succeeded: [], failures: new Map(), stopped: false };
  let done = 0;
  hooks.onProgress({ phase: "inventory", done, total: lines.length });
  for (const l of lines) {
    if (hooks.shouldStop()) {
      out.stopped = true;
      break;
    }
    try {
      // 1. tracking and the sell-at-zero rule (one call per product, up to 250 variants each)
      const edits = l.changes
        .filter((c) => c.track || c.policy)
        .map((c) => ({
          id: c.variant.id,
          ...(c.policy ? { inventoryPolicy: "DENY" } : {}),
          ...(c.track ? { inventoryItem: { tracked: true } } : {}),
        }));
      for (let i = 0; i < edits.length; i += BATCH) {
        const d = await adminGraphql<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(UPDATE_VARIANTS, {
          productId: l.product.id,
          variants: edits.slice(i, i + BATCH),
        });
        assertNoUserErrors(d.productVariantsBulkUpdate.userErrors, "Updating variants");
      }
      // 2. the quantity, after tracking is on
      const quantities = l.changes.flatMap((c) =>
        c.setAt.map((locationId) => ({ inventoryItemId: c.variant.itemId, locationId, quantity: settings.quantity, changeFromQuantity: null })),
      );
      for (let i = 0; i < quantities.length; i += BATCH) {
        const d = await adminGraphql<{ inventorySetQuantities: { userErrors: { message: string }[] } }>(SET_QUANTITIES, {
          input: { name: "available", reason: "correction", quantities: quantities.slice(i, i + BATCH) },
        });
        assertNoUserErrors(d.inventorySetQuantities.userErrors, "Setting quantities");
      }
      // 3. take the variants out of the locations that are not wanted (after the wanted ones hold stock)
      for (const c of l.changes) {
        for (const level of c.remove) {
          const d = await adminGraphql<{ inventoryDeactivate: { userErrors: { message: string }[] } }>(DEACTIVATE, { id: level.id });
          assertNoUserErrors(d.inventoryDeactivate.userErrors, `Removing ${level.name}`);
        }
      }
      out.succeeded.push(l.product.id);
    } catch (err) {
      out.failures.set(l.product.id, message(err));
    }
    done++;
    hooks.onProgress({ phase: "inventory", done, total: lines.length });
  }
  return out;
}

/** Applies the lines, reads them back, and returns one report row per line. */
export async function runStock(settings: StockSettings, lines: StockLine[], hooks: RunHooks): Promise<{ rows: ReportRow[] }> {
  hooks.onStage?.("applying");
  const applied = await applyLines(lines, settings, hooks);

  hooks.onStage?.("verifying");
  const finished = lines.filter((l) => applied.succeeded.includes(l.product.id));
  let mismatches: Finding[] = [];
  let final: Record<string, ProductStock> = {};
  let readError = "";
  try {
    final = await readStock(finished.map((l) => l.product.id));
    mismatches = findStockMismatch(finished, settings, final);
    if (mismatches.length > 0) {
      await wait(hooks.retryWaitMs ?? 1500);
      const bad = new Set(mismatches.map((m) => m.productId));
      const again = finished.filter((l) => bad.has(l.product.id));
      const reread = await readStock(again.map((l) => l.product.id));
      final = { ...final, ...reread };
      mismatches = findStockMismatch(again, settings, reread);
    }
  } catch (err) {
    readError = message(err);
  }
  const mismatchBy = new Map<string, string>();
  for (const m of mismatches) mismatchBy.set(m.productId, [mismatchBy.get(m.productId), m.message].filter(Boolean).join(" "));

  const rows = lines.map((l): ReportRow => {
    const base = { productId: l.product.id, title: l.product.title, handle: l.product.handle };
    const before = describeStock(l.before);
    const added = changeLabels(l, settings);
    const failure = applied.failures.get(l.product.id);
    if (failure !== undefined) return { ...base, before, after: before, added: [], removed: [], status: "failed", message: failure };
    if (!applied.succeeded.includes(l.product.id)) return { ...base, before, after: before, added: [], removed: [], status: "not applied", message: "Not reached (stopped)." };
    if (readError) return { ...base, before, after: "unknown", added, removed: [], status: "not verified", message: `Could not read it back: ${readError}` };
    const after = final[l.product.id] ? describeStock(final[l.product.id]!.variants) : "unknown";
    const mismatch = mismatchBy.get(l.product.id);
    if (mismatch) return { ...base, before, after, added, removed: [], status: "not verified", message: mismatch };
    return { ...base, before, after, added, removed: [], status: "done", message: "" };
  });
  return { rows };
}

export function stockEngine(plan: StockPlan): RunEngine<StockLine> {
  return {
    lines: plan.lines,
    recheck: (lines) => recheckStock(lines, plan.settings),
    run: (lines, hooks) => runStock(plan.settings, lines, hooks),
    describe: (l) => ({ productId: l.product.id, title: l.product.title, handle: l.product.handle }),
  };
}
