// Base addresses the person types in by hand, one per market. Saved in THIS browser only (localStorage):
// the app has no server and no database. A manual address wins over the one read from Shopify.

const KEY = "ad-regional-products:market-domains";

export type DomainOverrides = Record<string, string>;

/** "hardman.de" -> "https://hardman.de". Accepts a subfolder ("hardman.com/fr"). Returns the cleaned address, or an error. */
export function normalizeBase(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: true, value: "" };
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "This is not a valid address." };
  }
  if (!url.hostname.includes(".")) return { ok: false, error: "The address needs a domain, like hardman.de." };
  if (url.search || url.hash) return { ok: false, error: "Leave out everything after the domain (no ? or #)." };
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/products(\/|$)/i.test(path)) return { ok: false, error: "Only the base address, without /products/…" };
  return { ok: true, value: `${url.protocol}//${url.host}${path}` };
}

export function readOverrides(storage: Pick<Storage, "getItem"> | null = safeStorage()): DomainOverrides {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  } catch {
    return {};
  }
}

/** Returns false when the browser would not save it (private window, blocked storage). */
export function writeOverrides(value: DomainOverrides, storage: Pick<Storage, "setItem"> | null = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
