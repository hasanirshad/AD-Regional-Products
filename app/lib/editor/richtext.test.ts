import { describe, expect, it } from "vitest";
import { markupToRichText, normalizeRichText, richTextToMarkup, sameRichText } from "./richtext";

const text = (value: string, extra: Record<string, unknown> = {}) => ({ type: "text", value, ...extra });
const p = (...children: unknown[]) => ({ type: "paragraph", children });
const root = (...children: unknown[]) => ({ type: "root", children });

describe("rich text markup", () => {
  it("keeps bold, italic, links, headings and lists through an edit", () => {
    const tree = root(
      { type: "heading", level: 2, children: [text("Care")] },
      p(text("Wipe with a "), text("damp", { bold: true }), text(" cloth, "), text("never", { italic: true }), text(". See "), {
        type: "link",
        url: "https://example.com/care",
        children: [text("the guide")],
      }),
      { type: "list", listType: "unordered", children: [{ type: "list-item", children: [text("Oak")] }, { type: "list-item", children: [text("Pine")] }] },
      { type: "list", listType: "ordered", children: [{ type: "list-item", children: [text("First")] }, { type: "list-item", children: [text("Second")] }] },
    );
    const markup = richTextToMarkup(JSON.stringify(tree));
    expect(markup.exact).toBe(true);
    expect(markup.text).toBe(
      "## Care\n\nWipe with a **damp** cloth, *never*. See [the guide](https://example.com/care)\n\n- Oak\n- Pine\n\n1. First\n2. Second",
    );
    expect(sameRichText(markupToRichText(markup.text), tree)).toBe(true);
  });

  it("changing only the words changes only the words", () => {
    const tree = root(p(text("Hello "), text("world", { bold: true })));
    const edited = markupToRichText(richTextToMarkup(tree).text.replace("world", "everyone"));
    expect(edited).toEqual(root(p(text("Hello "), text("everyone", { bold: true }))));
  });

  it("handles bold and italic together and literal stars", () => {
    const tree = root(p(text("a * b"), text(" both", { bold: true, italic: true })));
    const markup = richTextToMarkup(tree);
    expect(markup.exact).toBe(true);
    expect(markup.text).toBe("a \\* b*** both***");
  });

  it("escapes text that would look like a heading or a list", () => {
    for (const value of ["# not a heading", "- not a bullet", "1. not a number"]) {
      const tree = root(p(text(value)));
      const markup = richTextToMarkup(tree);
      expect(markup.exact).toBe(true);
      expect(markupToRichText(markup.text)).toEqual(tree);
    }
  });

  it("ignores false flags and split pieces that look the same", () => {
    const a = root(p(text("Hel", { bold: false }), text("lo")));
    const b = root(p(text("Hello")));
    expect(sameRichText(a, b)).toBe(true);
    expect(normalizeRichText(a)).toEqual(b);
    expect(richTextToMarkup(a).exact).toBe(true);
  });

  it("says when it cannot keep a value exactly, so it is never edited", () => {
    const withTitle = root(p({ type: "link", url: "https://x.com", title: "Tip", children: [text("x")] }));
    expect(richTextToMarkup(withTitle).exact).toBe(false);
    const unknownBlock = root({ type: "code", children: [text("x")] });
    expect(richTextToMarkup(unknownBlock).exact).toBe(false);
    expect(richTextToMarkup("not json").exact).toBe(false);
    expect(richTextToMarkup(root(p())).exact).toBe(false);
  });

  it("builds paragraphs from plain text", () => {
    expect(markupToRichText("One\n\nTwo")).toEqual(root(p(text("One")), p(text("Two"))));
    expect(markupToRichText("")).toEqual(root());
  });
});
