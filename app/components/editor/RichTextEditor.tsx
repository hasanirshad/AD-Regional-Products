import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cleanPasted, cleanUp, fromEditable, toEditable } from "../../lib/editor/richDom";
import { normalizeUrl } from "../../lib/editor/richHtml";
import { TextBox } from "./TextBox";

// A small visual editor for product descriptions (what Shopify shows: paragraphs, headings, bold, italic, lists, links),
// with an HTML view for the rest. No library: one contenteditable box and the browser's own editing commands.
// Opening a description never changes it; the text is sent on only after the person types (see richDom.ts).

const PAUSE_MS = 250;

const CSS = `
.ad-rte-box{min-height:var(--ad-rte-min,160px);max-height:60vh;overflow:auto;padding:12px;outline:none;line-height:1.5;font-size:14px;word-break:break-word;color:var(--p-color-text,#303030)}
.ad-rte-box:empty:before{content:attr(data-placeholder);color:var(--p-color-text-secondary,#8a8a8a)}
.ad-rte-box p{margin:0 0 .75em}
.ad-rte-box h1{font-size:1.6em;margin:.6em 0 .4em}.ad-rte-box h2{font-size:1.35em;margin:.6em 0 .4em}.ad-rte-box h3{font-size:1.15em;margin:.6em 0 .4em}
.ad-rte-box h4,.ad-rte-box h5,.ad-rte-box h6{font-size:1em;margin:.6em 0 .4em}
.ad-rte-box ul,.ad-rte-box ol{margin:0 0 .75em;padding-left:1.6em}
.ad-rte-box a{color:var(--p-color-text-link,#005bd3);text-decoration:underline}
.ad-rte-box blockquote{margin:0 0 .75em;padding-left:12px;border-left:3px solid var(--p-color-border,#c9c9c9);color:var(--p-color-text-secondary,#616161)}
.ad-rte-box img{max-width:100%;height:auto}
.ad-rte-box table{border-collapse:collapse;max-width:100%}.ad-rte-box td,.ad-rte-box th{border:1px solid var(--p-color-border,#c9c9c9);padding:4px 6px}
.ad-rte-chip{display:inline-block;margin:2px 0;padding:2px 8px;border-radius:8px;background:var(--p-color-bg-surface-secondary,#f1f1f1);color:var(--p-color-text-secondary,#616161);font-size:12px;user-select:none}
.ad-rte-btn{min-width:30px;height:30px;padding:0 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--p-color-text,#303030);font:inherit;font-size:13px;cursor:pointer}
.ad-rte-btn:hover:not(:disabled){background:var(--p-color-bg-surface-hover,#f1f1f1)}
.ad-rte-btn[aria-pressed="true"]{background:var(--p-color-bg-surface-active,#e3e3e3);border-color:var(--p-color-border,#c9c9c9)}
.ad-rte-btn:disabled{opacity:.45;cursor:default}
.ad-rte-wrap:focus-within{outline:2px solid var(--p-color-border-focus,#005bd3);outline-offset:1px}
`;

let styled = false;
function ensureStyle(): void {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const el = document.createElement("style");
  el.setAttribute("data-ad-rte", "");
  el.textContent = CSS;
  document.head.appendChild(el);
}

type Active = { bold: boolean; italic: boolean; underline: boolean; ul: boolean; ol: boolean; block: string };
const NONE: Active = { bold: false, italic: false, underline: false, ul: false, ol: false, block: "p" };

const wrapStyle: CSSProperties = { border: "1px solid var(--p-color-border, #c9c9c9)", borderRadius: 12, background: "var(--p-color-bg-surface, #fff)", overflow: "hidden" };
const barStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, padding: "6px 8px", borderBottom: "1px solid var(--p-color-border, #e3e3e3)", background: "var(--p-color-bg-surface-secondary, #fafafa)" };
const sep: CSSProperties = { width: 1, height: 18, margin: "0 4px", background: "var(--p-color-border, #d9d9d9)" };

export function RichTextEditor({
  label,
  value,
  onChange,
  disabled,
  minHeight = 160,
  placeholder,
}: {
  label: string;
  /** The HTML as stored. */
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  minHeight?: number;
  placeholder?: string;
}) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [active, setActive] = useState<Active>(NONE);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  // The box stays readable while the editor is going away (a pending edit is sent then), but not after switching to the HTML view.
  const last = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const kept = useRef<string[]>([]);
  const shown = useRef<string | null>(null);
  const sent = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const range = useRef<Range | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(ensureStyle, []);

  const read = useCallback((): string => (last.current ? fromEditable(last.current.innerHTML, kept.current) : sent.current), []);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!last.current) return;
    const html = read();
    if (html !== sent.current) {
      sent.current = html;
      shown.current = html;
      onChangeRef.current(html);
    }
  }, [read]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, PAUSE_MS);
  }, [flush]);

  useEffect(() => flush, [flush]);

  // Show the stored text. A change that did not come from typing here (Undo, copy, discard) replaces what is shown.
  useEffect(() => {
    if (mode !== "visual" || !box.current) return;
    if (shown.current !== null && value.trim() === shown.current.trim()) return;
    const e = toEditable(value);
    kept.current = e.kept;
    box.current.innerHTML = e.html;
    shown.current = value;
    sent.current = value;
  }, [value, mode]);

  // Remember the selection (the toolbar and the link box take the focus) and show which formats are on.
  useEffect(() => {
    const onSelection = () => {
      const sel = window.getSelection();
      const el = box.current;
      if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
      range.current = sel.getRangeAt(0).cloneRange();
      const next: Active = {
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        ul: document.queryCommandState("insertUnorderedList"),
        ol: document.queryCommandState("insertOrderedList"),
        block: String(document.queryCommandValue("formatBlock") || "p").toLowerCase().replace(/[<>]/g, ""),
      };
      setActive((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  /** Remember the selection right now (the toolbar is about to take the focus, and the selection event can arrive after that). */
  const saveRangeNow = () => {
    const sel = window.getSelection();
    const el = box.current;
    if (el && sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };

  const restore = () => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && range.current) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };

  const exec = (command: string, arg?: string) => {
    if (disabled || !box.current) return;
    restore();
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      /* not supported: the browser's own line handling is used */
    }
    document.execCommand(command, false, arg);
    schedule();
  };

  const replaceAll = (html: string) => {
    if (!box.current) return;
    const e = toEditable(html);
    kept.current = e.kept;
    box.current.innerHTML = e.html;
    schedule();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    e.preventDefault();
    if (html) document.execCommand("insertHTML", false, cleanPasted(html));
    else document.execCommand("insertText", false, text);
    schedule();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openLink();
    }
  };

  const openLink = () => {
    saveRangeNow();
    const sel = window.getSelection();
    const existing = sel?.anchorNode instanceof Node ? (sel.anchorNode.parentElement?.closest("a") as HTMLAnchorElement | null) : null;
    setLinkText(existing?.getAttribute("href") ?? "");
    setLinkError(null);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = normalizeUrl(linkText);
    if (!url) {
      setLinkError("Enter a web address (https://…), an email (mailto:…) or a phone number (tel:…).");
      return;
    }
    restore();
    const el = box.current;
    const styled = new Set(Array.from(el?.querySelectorAll("a[style]") ?? []));
    const sel = window.getSelection();
    if (sel && sel.isCollapsed) document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/[<>&]/g, "")}</a>`);
    else document.execCommand("createLink", false, url);
    // The browser copies the surrounding font and colour onto a new link: not wanted.
    for (const a of Array.from(el?.querySelectorAll("a[style]") ?? [])) if (!styled.has(a)) a.removeAttribute("style");
    setLinkOpen(false);
    schedule();
  };

  const switchMode = (next: "visual" | "html") => {
    if (next === mode) return;
    if (mode === "visual") flush();
    shown.current = null;
    setMode(next);
  };

  const btn = (title: string, content: ReactNode, onClick: () => void, pressed?: boolean) => (
    <button type="button" className="ad-rte-btn" title={title} aria-label={title} aria-pressed={pressed === undefined ? undefined : pressed} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  );

  if (mode === "html") {
    return (
      <s-stack gap="small-200">
        <TextBox label={`${label} (HTML)`} hideLabel value={value} multiline rows={12} disabled={disabled} onChange={(html) => { sent.current = html; onChange(html); }} details="This is the HTML Shopify stores." />
        <div>
          <s-button variant="tertiary" onClick={() => switchMode("visual")}>
            Back to the visual editor
          </s-button>
        </div>
      </s-stack>
    );
  }

  return (
    <div className="ad-rte-wrap" style={wrapStyle}>
      {/* Keep the selection in the text while a toolbar button is pressed (the block list and the link box need the focus). */}
      <div
        role="toolbar"
        aria-label={`${label} formatting`}
        style={barStyle}
        onMouseDown={(e) => {
          const t = e.target as HTMLElement;
          saveRangeNow();
          if (t.tagName !== "SELECT" && t.tagName !== "INPUT") e.preventDefault();
        }}
      >
        <select
          aria-label="Text style"
          disabled={disabled}
          value={/^h[1-4]$|^blockquote$/.test(active.block) ? active.block : "p"}
          onChange={(e) => exec("formatBlock", `<${e.target.value}>`)}
          style={{ height: 30, borderRadius: 8, border: "1px solid var(--p-color-border, #c9c9c9)", background: "var(--p-color-bg-surface, #fff)", color: "inherit", font: "inherit", fontSize: 13, padding: "0 6px" }}
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
          <option value="blockquote">Quote</option>
        </select>
        <span style={sep} />
        {btn("Bold (Ctrl+B)", <strong>B</strong>, () => exec("bold"), active.bold)}
        {btn("Italic (Ctrl+I)", <em>I</em>, () => exec("italic"), active.italic)}
        {btn("Underline (Ctrl+U)", <u>U</u>, () => exec("underline"), active.underline)}
        <span style={sep} />
        {btn("Bulleted list", "• List", () => exec("insertUnorderedList"), active.ul)}
        {btn("Numbered list", "1. List", () => exec("insertOrderedList"), active.ol)}
        <span style={sep} />
        {btn("Add or change a link (Ctrl+K)", "Link", openLink)}
        {btn("Remove the link", "Unlink", () => exec("unlink"))}
        <span style={sep} />
        {btn("Remove bold, italic and other formatting from the selection", "Clear", () => exec("removeFormat"))}
        {btn("Clean up: remove colours, fonts, classes and empty paragraphs from the whole text", "Clean up", () => { if (box.current) replaceAll(cleanUp(box.current.innerHTML)); })}
        <span style={sep} />
        {btn("Undo (Ctrl+Z)", "Undo", () => exec("undo"))}
        {btn("Redo (Ctrl+Y)", "Redo", () => exec("redo"))}
        <span style={{ flex: 1 }} />
        {btn("Show and edit the HTML", "HTML", () => switchMode("html"))}
      </div>
      {linkOpen ? (
        <div style={{ ...barStyle, borderTop: "none" }}>
          <input
            aria-label="Link address"
            autoFocus
            value={linkText}
            placeholder="https://example.com"
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") setLinkOpen(false);
            }}
            style={{ flex: 1, minWidth: 180, height: 30, borderRadius: 8, border: "1px solid var(--p-color-border, #c9c9c9)", padding: "0 8px", font: "inherit", fontSize: 13, background: "var(--p-color-bg-surface, #fff)", color: "inherit" }}
          />
          <button type="button" className="ad-rte-btn" onClick={applyLink}>
            Apply
          </button>
          <button type="button" className="ad-rte-btn" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
          {linkError ? <span style={{ flexBasis: "100%", color: "var(--p-color-text-critical, #8e1f0b)", fontSize: 12 }}>{linkError}</span> : null}
        </div>
      ) : null}
      <div
        ref={(el) => {
          box.current = el;
          if (el) last.current = el;
          else if (modeRef.current === "html") last.current = null;
        }}
        className="ad-rte-box"
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-placeholder={placeholder ?? ""}
        contentEditable={!disabled}
        suppressContentEditableWarning
        style={{ ["--ad-rte-min" as string]: `${minHeight}px`, opacity: disabled ? 0.6 : 1 }}
        onInput={schedule}
        onBlur={flush}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
