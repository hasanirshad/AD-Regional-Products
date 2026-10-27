// Rich text metafields. Shopify stores them as a JSON tree (paragraphs, headings, lists, links, bold, italic).
// To edit the words without losing that formatting, the tree is shown as a small text markup and read back:
//   blank line between blocks    # heading (1 to 6 #)    - bullet    1. numbered
//   **bold**   *italic*   ***both***   [link text](https://example.com)    \* writes a literal star
// Pure functions. `richTextToMarkup` says whether the round trip is exact; when it is not, the value is not edited
// (so a save can never flatten or damage it).

type Json = Record<string, unknown>;

interface Inline {
  type: "text" | "link";
  value?: string;
  bold?: boolean;
  italic?: boolean;
  url?: string;
  children?: Inline[];
}

function isObject(v: unknown): v is Json {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

// ---------- Normal form (so cosmetic differences do not count as changes) ----------

/** Drops false flags and merges neighbouring text pieces that look the same. */
export function normalizeRichText(node: unknown): unknown {
  if (Array.isArray(node)) return mergeText(node.map(normalizeRichText));
  if (!isObject(node)) return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if ((key === "bold" || key === "italic") && value === false) continue;
    out[key] = key === "children" ? normalizeRichText(value) : value;
  }
  return out;
}

function mergeText(items: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (
      isObject(item) &&
      isObject(last) &&
      item.type === "text" &&
      last.type === "text" &&
      Boolean(item.bold) === Boolean(last.bold) &&
      Boolean(item.italic) === Boolean(last.italic) &&
      typeof item.value === "string" &&
      typeof last.value === "string"
    ) {
      out[out.length - 1] = { ...last, value: last.value + item.value };
    } else out.push(item);
  }
  return out;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameRichText(a: unknown, b: unknown): boolean {
  return stable(normalizeRichText(a)) === stable(normalizeRichText(b));
}

// ---------- Tree -> markup ----------

const escapeText = (s: string) => s.replace(/[\\*[\]]/g, (c) => `\\${c}`);

function inlineToMarkup(nodes: unknown[]): string {
  return nodes
    .map((n) => {
      if (!isObject(n)) return "";
      if (n.type === "link") {
        const inner = inlineToMarkup(Array.isArray(n.children) ? n.children : []);
        return `[${inner}](${String(n.url ?? "")})`;
      }
      const value = typeof n.value === "string" ? n.value : "";
      if (value === "") return "";
      const mark = n.bold && n.italic ? "***" : n.bold ? "**" : n.italic ? "*" : "";
      return `${mark}${escapeText(value)}${mark}`;
    })
    .join("");
}

/** Escapes a block's first characters so they are not read as a heading or list marker. */
function guardStart(text: string): string {
  if (/^#{1,6} /.test(text)) return `\\${text}`;
  if (/^- /.test(text)) return `\\${text}`;
  return text.replace(/^(\d+)\. /, "$1\\. ");
}

function blockToMarkup(block: unknown): string | null {
  if (!isObject(block)) return null;
  const children = Array.isArray(block.children) ? block.children : [];
  switch (block.type) {
    case "paragraph": {
      const text = inlineToMarkup(children);
      return text === "" ? null : guardStart(text);
    }
    case "heading": {
      const level = Number(block.level);
      if (!(level >= 1 && level <= 6)) return null;
      return `${"#".repeat(level)} ${inlineToMarkup(children)}`;
    }
    case "list": {
      const ordered = block.listType === "ordered";
      const lines = children.map((item, i) => {
        const inner = isObject(item) && Array.isArray(item.children) ? inlineToMarkup(item.children) : "";
        return `${ordered ? `${i + 1}.` : "-"} ${inner}`;
      });
      return lines.join("\n");
    }
    default:
      return null;
  }
}

export interface MarkupResult {
  /** The markup text. Empty when the value cannot be shown as markup. */
  text: string;
  /** True only when turning the text back into a tree gives exactly the same tree. */
  exact: boolean;
}

/** `raw` is the stored JSON (string or already parsed). */
export function richTextToMarkup(raw: unknown): MarkupResult {
  const root = typeof raw === "string" ? safeParse(raw) : raw;
  if (!isObject(root) || root.type !== "root" || !Array.isArray(root.children)) return { text: "", exact: false };
  const blocks: string[] = [];
  for (const child of root.children) {
    const text = blockToMarkup(child);
    if (text === null) return { text: "", exact: false };
    blocks.push(text);
  }
  const text = blocks.join("\n\n");
  return { text, exact: sameRichText(markupToRichText(text), root) };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- Markup -> tree ----------

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let bold = false;
  let italic = false;
  let buffer = "";
  const flush = () => {
    if (buffer === "") return;
    const node: Inline = { type: "text", value: buffer };
    if (bold) node.bold = true;
    if (italic) node.italic = true;
    out.push(node);
    buffer = "";
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      buffer += text[i + 1];
      i += 1;
    } else if (c === "*") {
      let run = 1;
      while (text[i + run] === "*") run += 1;
      i += run - 1;
      flush();
      if (run === 1) italic = !italic;
      else if (run === 2) bold = !bold;
      else if (run === 3) {
        bold = !bold;
        italic = !italic;
      } else buffer += "*".repeat(run); // unusual: keep the stars as text
    } else if (c === "[") {
      const link = readLink(text, i);
      if (link) {
        flush();
        const inner = parseInline(link.label);
        out.push({ type: "link", url: link.url, children: inner.length > 0 ? inner : [{ type: "text", value: link.url }] });
        i = link.end;
      } else buffer += c;
    } else buffer += c;
  }
  flush();
  return out;
}

/** Reads `[label](url)` starting at `start`. Stars and brackets inside the label may be escaped. */
function readLink(text: string, start: number): { label: string; url: string; end: number } | null {
  let i = start + 1;
  let label = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      label += c + text[i + 1];
      i += 2;
    } else if (c === "]") break;
    else {
      label += c;
      i += 1;
    }
  }
  if (text[i] !== "]" || text[i + 1] !== "(") return null;
  const close = text.indexOf(")", i + 2);
  if (close < 0) return null;
  const url = text.slice(i + 2, close);
  if (!url || /\s/.test(url)) return null;
  return { label, url, end: close };
}

function blockFrom(block: string): Json {
  const lines = block.split("\n");
  if (lines.length === 1) {
    const heading = /^(#{1,6}) (.*)$/.exec(lines[0] ?? "");
    if (heading) return { type: "heading", level: (heading[1] ?? "").length, children: parseInline(heading[2] ?? "") };
  }
  if (lines.every((l) => /^- /.test(l))) {
    return {
      type: "list",
      listType: "unordered",
      children: lines.map((l) => ({ type: "list-item", children: parseInline(l.slice(2)) })),
    };
  }
  if (lines.every((l) => /^\d+\. /.test(l))) {
    return {
      type: "list",
      listType: "ordered",
      children: lines.map((l) => ({ type: "list-item", children: parseInline(l.replace(/^\d+\. /, "")) })),
    };
  }
  return { type: "paragraph", children: parseInline(block) };
}

/** Markup text -> rich text tree. Blank lines separate blocks. */
export function markupToRichText(text: string): Json {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.replace(/^\n+|\n+$/g, ""))
    .filter((b) => b.trim() !== "");
  return { type: "root", children: blocks.map(blockFrom) };
}
