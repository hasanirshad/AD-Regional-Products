// The DOM side of the description editor. Browser only (DOMParser), tested in Chromium, not in the node tests.
//
// Rule: opening a description in the editor must never change it. The editor shows a safe copy; things that cannot be shown
// as text (videos, embeds, style blocks) are swapped for a locked placeholder and put back, exactly as they were, when the
// text is read back. Nothing is sent to Shopify until the person types.

import { isBlankHtml, KEEP_HIDDEN, KEEP_SHOWN, normalizeUrl } from "./richHtml";

const KEEP_SELECTOR = [...KEEP_SHOWN, ...KEEP_HIDDEN].join(",");
const HIDDEN = new Set<string>(KEEP_HIDDEN);

const parse = (html: string): Document => new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}`, "text/html");

const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "srcset"];

/** Drops event handlers and script links. Used on everything that is shown. */
function makeSafe(root: Element): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if (URL_ATTRS.includes(name) && /^\s*(javascript|vbscript):/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  }
}

export type Editable = { html: string; kept: string[] };

/** The stored HTML as the editor shows it. */
export function toEditable(html: string): Editable {
  const doc = parse(html);
  const kept: string[] = [];
  const found = Array.from(doc.body.querySelectorAll(KEEP_SELECTOR)).filter((el) => !el.parentElement?.closest(KEEP_SELECTOR));
  for (const el of found) {
    const tag = el.tagName.toLowerCase();
    const mark = doc.createElement("span");
    mark.setAttribute("data-rt-keep", String(kept.length));
    mark.setAttribute("contenteditable", "false");
    if (HIDDEN.has(tag)) mark.setAttribute("style", "display:none");
    else {
      mark.className = "ad-rte-chip";
      mark.textContent = tag === "iframe" || tag === "video" || tag === "audio" ? `Embedded ${tag === "iframe" ? "content" : tag}` : `Kept as is: ${tag}`;
    }
    kept.push(el.outerHTML);
    el.replaceWith(mark);
  }
  makeSafe(doc.body);
  return { html: doc.body.innerHTML, kept };
}

const RENAME: Record<string, string> = { b: "strong", i: "em", strike: "s" };

/** What is in the editor, as the HTML to store. Placeholders are replaced by the original pieces. */
export function fromEditable(html: string, kept: string[]): string {
  const doc = parse(html);
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    el.removeAttribute("contenteditable");
    const to = RENAME[tag];
    if (to) {
      const next = doc.createElement(to);
      for (const a of Array.from(el.attributes)) next.setAttribute(a.name, a.value);
      while (el.firstChild) next.appendChild(el.firstChild);
      el.replaceWith(next);
    }
  }
  // Editing leaves empty formatting tags behind (<b></b>): drop them.
  for (const el of Array.from(doc.body.querySelectorAll("b,strong,i,em,u,s,span,font,a"))) {
    const keepsA = el.tagName === "A" && el.attributes.length > 0;
    if (!el.hasAttribute("data-rt-keep") && !keepsA && (el.textContent ?? "") === "" && !el.querySelector("img,br,iframe,video,audio,object,embed,svg,hr,input,button,select,textarea,canvas")) el.remove();
  }
  for (const mark of Array.from(doc.body.querySelectorAll("[data-rt-keep]"))) {
    const original = kept[Number(mark.getAttribute("data-rt-keep"))];
    if (original === undefined) mark.remove();
    else {
      const t = doc.createElement("template");
      t.innerHTML = original;
      mark.replaceWith(t.content);
    }
  }
  const out = doc.body.innerHTML.trim();
  return isBlankHtml(out) ? "" : out;
}

const ALLOWED = new Set(["p", "br", "strong", "em", "u", "s", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "a", "blockquote", "hr", "sup", "sub"]);

/** Pasted text: structure only (paragraphs, headings, lists, bold, italic, links). Colours, fonts and classes are left behind. */
export function cleanPasted(html: string): string {
  const doc = parse(html);
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) {
        child.remove();
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (/^(script|style|iframe|object|embed|form|svg|canvas|template|noscript|link|meta|head|title)$/.test(tag)) {
        el.remove();
        continue;
      }
      walk(el);
      const weight = el.style.fontWeight;
      const bold = tag === "span" && (weight === "bold" || /^[6-9]00$/.test(weight));
      const italic = tag === "span" && el.style.fontStyle === "italic";
      const to = tag === "b" ? (weight === "normal" ? "" : "strong") : tag === "i" ? "em" : bold ? "strong" : italic ? "em" : tag;
      if (to === "" || !ALLOWED.has(to)) {
        el.replaceWith(...Array.from(el.childNodes));
        continue;
      }
      const next = doc.createElement(to);
      if (to === "a") {
        const href = normalizeUrl(el.getAttribute("href") ?? "");
        if (href) next.setAttribute("href", href);
      }
      while (el.firstChild) next.appendChild(el.firstChild);
      el.replaceWith(next);
    }
  };
  walk(doc.body);
  // Bare text in a div (Word, Docs) becomes paragraphs.
  for (const div of Array.from(doc.body.querySelectorAll("div"))) div.replaceWith(...Array.from(div.childNodes));
  return doc.body.innerHTML.trim();
}

/** "Clean up formatting": removes classes, inline styles, ids, data attributes, comments, empty paragraphs and plain spans. Placeholders stay. */
export function cleanUp(editableHtml: string): string {
  const doc = parse(editableHtml);
  const sweepComments = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 8) child.remove();
      else sweepComments(child);
    }
  };
  sweepComments(doc.body);
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    if (el.hasAttribute("data-rt-keep")) continue;
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      if (n === "class" || n === "style" || n === "id" || n === "dir" || n === "lang" || n.startsWith("data-") || n.startsWith("aria-")) el.removeAttribute(attr.name);
    }
  }
  for (const el of Array.from(doc.body.querySelectorAll("span,font"))) {
    if (el.hasAttribute("data-rt-keep") || el.className === "ad-rte-chip") continue;
    el.replaceWith(...Array.from(el.childNodes));
  }
  for (const p of Array.from(doc.body.querySelectorAll("p,div"))) {
    if ((p.textContent ?? "").trim() === "" && !p.querySelector("img,iframe,video,hr,[data-rt-keep]")) p.remove();
  }
  return doc.body.innerHTML.trim();
}
