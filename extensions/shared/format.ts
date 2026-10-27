// Plain formatting helpers. No Shopify calls here.

export type Money = { amount: number; currency: string };

export function parseMoney(raw: { amount?: string | number | null; currencyCode?: string | null } | null | undefined): Money | null {
  if (!raw || raw.amount == null) return null;
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: raw.currencyCode ?? "" };
}

export function formatMoney(m: Money | null): string {
  if (!m) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: m.currency || "USD", maximumFractionDigits: m.amount % 1 === 0 ? 0 : 2 }).format(m.amount);
  } catch {
    return `${m.amount} ${m.currency}`.trim();
  }
}

/** "£1,200" or "£1,200 – £2,400". */
export function formatRange(low: Money | null, high: Money | null): string {
  if (!low && !high) return "—";
  if (!low || !high) return formatMoney(low ?? high);
  if (low.amount === high.amount && low.currency === high.currency) return formatMoney(low);
  return `${formatMoney(low)} – ${formatMoney(high)}`;
}

/** Whole-number percentage of the compare-at price that is taken off, or null when there is no sale. */
export function discountPercent(price: Money | null, compareAt: Money | null): number | null {
  if (!price || !compareAt || compareAt.amount <= 0 || compareAt.amount <= price.amount) return null;
  return Math.round(((compareAt.amount - price.amount) / compareAt.amount) * 100);
}

export function formatPercentRange(values: (number | null)[]): string {
  const v = values.filter((x): x is number => x != null);
  if (!v.length) return "—";
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Text for comparing a source and its translation: surrounding spaces and repeated spaces do not count. */
export const normalizeText = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function hasEdgeSpace(s: string): boolean {
  return s.length > 0 && s !== s.trim();
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " " };

/** Event messages come as small pieces of HTML. Only the text is shown. */
export function plainText(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} day${d === 1 ? "" : "s"} ago`;
  return formatDateTime(iso);
}

export const shortList = (items: string[], max = 3) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));
