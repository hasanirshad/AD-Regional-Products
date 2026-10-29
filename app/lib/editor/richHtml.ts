// Small pure helpers for the description editor (no DOM, so they run in the normal tests).
// The editor itself (components/editor/RichTextEditor.tsx) works on the real DOM; the DOM parts are in richDom.ts.

const NAMED: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", hellip: "…" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return NAMED[code.toLowerCase()] ?? all;
  });
}

/** The words of an HTML text, for previews and "is it empty?". Styles, scripts and comments are dropped; blocks become spaces. */
export function plainText(html: string): string {
  const noCode = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const spaced = noCode.replace(/<\/(p|div|li|h[1-6]|tr|blockquote|ul|ol|table)\s*>|<br\s*\/?>|<hr\s*\/?>/gi, " ");
  return decode(spaced.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** A short text for a table cell. */
export function previewText(html: string, max = 110): string {
  const t = plainText(html);
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** No words and nothing that shows (a picture, a video, a line). */
export function isBlankHtml(html: string): boolean {
  if (plainText(html) !== "") return false;
  return !/<(img|iframe|video|audio|object|embed|hr|table|svg)\b/i.test(html);
}

/**
 * The address typed into the link box, made safe: web, mail and phone links only, https added to a bare domain.
 * Null when it cannot be a link.
 */
export function normalizeUrl(input: string): string | null {
  const url = input.trim();
  if (url === "" || /\s/.test(url)) return null;
  if (url.startsWith("/") || url.startsWith("#")) return url;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme) return ["http", "https", "mailto", "tel"].includes(scheme) ? url : null;
  return /^[^\s/@]+\.[^\s/@]{2,}([/?#].*)?$/.test(url) ? `https://${url}` : null;
}

/** Tags that are kept exactly as they were and shown as a small block in the editor (they cannot be edited as text). */
export const KEEP_SHOWN = ["iframe", "video", "audio", "object", "embed", "form", "input", "button", "select", "textarea", "svg", "canvas"] as const;
/** Tags that are kept exactly as they were and not shown at all. */
export const KEEP_HIDDEN = ["script", "style", "link", "meta", "noscript", "template"] as const;
