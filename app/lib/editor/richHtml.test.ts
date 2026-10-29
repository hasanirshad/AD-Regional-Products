import { describe, expect, it } from "vitest";
import { isBlankHtml, normalizeUrl, plainText, previewText } from "./richHtml";

describe("plainText", () => {
  it("reads the words of a description and separates blocks", () => {
    expect(plainText("<p>The AEMILIA table</p><p>pays homage&nbsp;to Danish</p>")).toBe("The AEMILIA table pays homage to Danish");
    expect(plainText("<ul><li>One</li><li>Two</li></ul>")).toBe("One Two");
    expect(plainText("Line one<br>Line two")).toBe("Line one Line two");
  });
  it("leaves out styles, scripts and comments (the pasted-from-Word case)", () => {
    const messy = '<style type="text/css"><!--td {border: 1px solid #ccc;}--></style><!-- x-tinymce/html --><p data-start="0">Groß &amp; stark</p><script>alert(1)</script>';
    expect(plainText(messy)).toBe("Groß & stark");
  });
  it("decodes numeric entities and keeps unknown ones as they are", () => {
    expect(plainText("&#8364;100 &#x26; &madeup;")).toBe("€100 & &madeup;");
  });
});

describe("previewText", () => {
  it("cuts a long text with an ellipsis and leaves a short one", () => {
    expect(previewText("<p>short</p>", 20)).toBe("short");
    expect(previewText(`<p>${"word ".repeat(40)}</p>`, 20)).toBe("word word word word…");
    expect(previewText(`<p>${"word ".repeat(40)}</p>`, 20).endsWith("…")).toBe(true);
  });
});

describe("isBlankHtml", () => {
  it("is blank for nothing, empty paragraphs and style only", () => {
    expect(isBlankHtml("")).toBe(true);
    expect(isBlankHtml("<p><br></p>")).toBe(true);
    expect(isBlankHtml("<p>&nbsp;</p><style>p{}</style>")).toBe(true);
  });
  it("is not blank when there are words or something that shows", () => {
    expect(isBlankHtml("<p>Oak</p>")).toBe(false);
    expect(isBlankHtml('<p><img src="a.jpg"></p>')).toBe(false);
    expect(isBlankHtml('<iframe src="https://youtube.com/embed/x"></iframe>')).toBe(false);
  });
});

describe("normalizeUrl", () => {
  it("accepts web, mail and phone links and adds https to a bare domain", () => {
    expect(normalizeUrl("https://hardman.design/a?b=1")).toBe("https://hardman.design/a?b=1");
    expect(normalizeUrl(" mailto:info@hardman.design ")).toBe("mailto:info@hardman.design");
    expect(normalizeUrl("tel:+4912345")).toBe("tel:+4912345");
    expect(normalizeUrl("hardman.design/tables")).toBe("https://hardman.design/tables");
    expect(normalizeUrl("/pages/care")).toBe("/pages/care");
    expect(normalizeUrl("#top")).toBe("#top");
  });
  it("refuses script links, other schemes, spaces and plain words", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(normalizeUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(normalizeUrl("ftp://x.com")).toBeNull();
    expect(normalizeUrl("two words.com")).toBeNull();
    expect(normalizeUrl("hello")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});
