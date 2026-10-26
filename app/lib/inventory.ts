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
  /** Available quantity at each chosen location (by location id). null = the variant is not stocked there. */
  quantities: Record<string, number | null>;
};

export type ProductStock = { id: string; status: string; variants: VariantStock[]; complete: boolean };

export type StockSettings = {
  track: boolean;
  /** Stop selling when sold out. */
  stopAtZero: boolean;
  setQuantity: boolean;
  quantity: number;
  /** The locations the quantity is set at. */
  locations: StockLocation[];
};

/** `setAt` = the chosen locations where this variant gets the quantity (it is stocked there and differs). */
export type VariantChange = { variant: VariantStock; track: boolean; policy: boolean; setAt: string[] };

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
  totals: { variants: number; track: number; policy: number; quantity: number; lowered: number; notStocked: number };
  blocker: string | null;
  warnings: string[];
};

// ---------------------------------------------------------------- reading

/** One aliased `inventoryLevel` per chosen location (l0, l1, ...), so every location is read in the same call. */
export const levelAlias = (i: number) => `l${i}`;

export function stockQuery(locationCount: number): string {
  const vars = Array.from({ length: locationCount }, (_, i) => `, $loc${i}: ID!`).join("");
  const levels = Array.from(
    { length: locationCount },
    (_, i) => `${levelAlias(i)}: inventoryLevel(locationId: $loc${i}) { id quantities(names: ["available"]) { name quantity } }`,
  ).join("\n                ");
  return `#graphql
  query InventoryStock($ids: [ID!]!, $first: Int!${vars}) {
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
              ${levels}
            }
          }
        }
      }
    }
  }`;
}

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
      inventoryItem?: ({
        id: string;
        tracked: boolean;
      } & Record<string, { quantities: { name: string; quantity: number }[] } | null | undefined | string | boolean>) | null;
    }[];
  };
} | null;

export function parseStock(raw: NonNullable<RawProduct>, locationIds: string[]): ProductStock {
  return {
    id: raw.id,
    status: raw.status,
    complete: !raw.variants.pageInfo.hasNextPage,
    variants: raw.variants.nodes.map((v) => {
      const quantities: Record<string, number | null> = {};
      locationIds.forEach((id, i) => {
        const level = v.inventoryItem?.[levelAlias(i)] as { quantities: { name: string; quantity: number }[] } | null | undefined;
        quantities[id] = level ? (level.quantities.find((q) => q.name === "available")?.quantity ?? 0) : null;
      });
      return {
        id: v.id,
        title: v.title,
        sku: v.sku ?? "",
        itemId: v.inventoryItem?.id ?? "",
        tracked: v.inventoryItem?.tracked ?? false,
        policy: v.inventoryPolicy === "DENY" ? "DENY" : "CONTINUE",
        quantities,
      };
    }),
  };
}

export async function loadStockLocations(): Promise<StockLocation[]> {
  const d = await adminGraphql<{ locations: { nodes: StockLocation[] } }>(LOCATIONS);
  return d.locations.nodes.map((l) => ({ id: l.id, name: l.name }));
}

const CHUNK = 3;
const FIRST = 100;
const FIRST_ALONE = 250;

/** Reads the stock settings of each product. Missing = not found. Products with very many variants are read on their own. */
export async function readStock(ids: string[], locationIds: string[]): Promise<Record<string, ProductStock>> {
  const out: Record<string, ProductStock> = {};
  const again: string[] = [];
  const query = stockQuery(locationIds.length);
  const locVars = Object.fromEntries(locationIds.map((id, i) => [`loc${i}`, id]));
  // Each chosen location adds to the cost of a read, so fewer products and variants per read when many are chosen.
  const chunk = Math.max(1, Math.floor(CHUNK / Math.max(1, Math.ceil(locationIds.length / 2))));
  const first = locationIds.length > 3 ? 50 : FIRST;
  for (let i = 0; i < ids.length; i += chunk) {
    const d = await adminGraphql<{ nodes: RawProduct[] }>(query, { ids: ids.slice(i, i + chunk), first, ...locVars });
    for (const n of d.nodes) {
      if (!n) continue;
      if (n.variants.pageInfo.hasNextPage) again.push(n.id);
      else out[n.id] = parseStock(n, locationIds);
    }
  }
  for (const id of again) {
    const d = await adminGraphql<{ nodes: RawProduct[] }>(query, { ids: [id], first: FIRST_ALONE, ...locVars });
    const n = d.nodes[0];
    if (n) out[n.id] = parseStock(n, locationIds);
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
  if (!s.track && !s.stopAtZero && !s.setQuantity) return "Choose at least one change.";
  if (s.setQuantity) {
    if (!Number.isInteger(s.quantity) || s.quantity < 0) return "The quantity must be a whole number, 0 or more.";
    if (s.quantity > 1_000_000) return "The quantity is too large.";
    if (s.locations.length === 0) return "Choose at least one location for the quantity.";
  }
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
  const totals = { variants: 0, track: 0, policy: 0, quantity: 0, lowered: 0, notStocked: 0 };

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
          const q = v.quantities[loc.id] ?? null;
          if (q === null) notStocked++;
          else if (q !== settings.quantity) {
            setAt.push(loc.id);
            if (q > settings.quantity) totals.lowered++;
          }
        }
      }
      if (track || policy || setAt.length > 0) {
        changes.push({ variant: v, track, policy, setAt });
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
  return { lines, unchanged, skipped, settings, totals, blocker: settingsProblem(settings), warnings };
}

/** One short line describing a product's variants, for the report. */
export function describeStock(variants: VariantStock[], locations: StockLocation[]): string {
  const n = variants.length;
  const tracked = variants.filter((v) => v.tracked).length;
  const stops = variants.filter((v) => v.policy === "DENY").length;
  const at = locations.map((loc) => {
    const qty = variants.map((v) => (v.quantities[loc.id] == null ? "–" : String(v.quantities[loc.id])));
    return `${loc.name} ${qty.length > 8 ? `${qty.slice(0, 8).join(", ")}, …` : qty.join(", ")}`;
  });
  return `tracked ${tracked}/${n} · stops at 0: ${stops}/${n}${at.length ? ` · stock: ${at.join(" | ")}` : ""}`;
}

export function changeLabels(l: StockLine, s: StockSettings): string[] {
  const out: string[] = [];
  const t = l.changes.filter((c) => c.track).length;
  const p = l.changes.filter((c) => c.policy).length;
  const q = l.changes.reduce((n, c) => n + c.setAt.length, 0);
  if (t) out.push(`Track quantity: ${t} variant${t === 1 ? "" : "s"}`);
  if (p) out.push(`Stop selling at 0: ${p} variant${p === 1 ? "" : "s"}`);
  if (q) out.push(`Quantity set to ${s.quantity}: ${q} stock level${q === 1 ? "" : "s"}`);
  return out;
}

// ---------------------------------------------------------------- checks

const sameVariant = (a: VariantStock, b: VariantStock) =>
  a.tracked === b.tracked && a.policy === b.policy && Object.keys(a.quantities).every((k) => a.quantities[k] === b.quantities[k]);

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
          const q = v.quantities[id];
          if (q !== settings.quantity) {
            const where = settings.locations.find((x) => x.id === id)?.name ?? "the location";
            out.push({ productId: l.product.id, title, message: `Variant ${name} shows ${q ?? "no"} in stock at ${where}, not ${settings.quantity}.` });
            break;
          }
        }
      }
    }
  }
  return out;
}

export async function recheckStock(lines: StockLine[], settings: StockSettings): Promise<Finding[]> {
  return findStockDrift(lines, await readStock(lines.map((l) => l.product.id), settings.locations.map((x) => x.id)));
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
  const locationIds = settings.locations.map((x) => x.id);
  let mismatches: Finding[] = [];
  let final: Record<string, ProductStock> = {};
  let readError = "";
  try {
    final = await readStock(finished.map((l) => l.product.id), locationIds);
    mismatches = findStockMismatch(finished, settings, final);
    if (mismatches.length > 0) {
      await wait(hooks.retryWaitMs ?? 1500);
      const bad = new Set(mismatches.map((m) => m.productId));
      const again = finished.filter((l) => bad.has(l.product.id));
      const reread = await readStock(again.map((l) => l.product.id), locationIds);
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
    const before = describeStock(l.before, settings.locations);
    const added = changeLabels(l, settings);
    const failure = applied.failures.get(l.product.id);
    if (failure !== undefined) return { ...base, before, after: before, added: [], removed: [], status: "failed", message: failure };
    if (!applied.succeeded.includes(l.product.id)) return { ...base, before, after: before, added: [], removed: [], status: "not applied", message: "Not reached (stopped)." };
    if (readError) return { ...base, before, after: "unknown", added, removed: [], status: "not verified", message: `Could not read it back: ${readError}` };
    const after = final[l.product.id] ? describeStock(final[l.product.id]!.variants, settings.locations) : "unknown";
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
