// A smoke render of the standard bar on the server (no browser): the search box, the Filters button, the chips, the closed
// popup with its footer buttons, the sections in their fixed order, and the selection line. Events (opening, closing the
// popup, removing a chip) need a real admin and are on the "not yet checked" list.

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_FILTERS, SECTION_ORDER, type FilterState } from "../../lib/filters/filterModel";
import { FilterSections, type FilterOptions } from "./FilterPopup";
import { SearchFilterBar, SEARCH_PLACEHOLDER } from "./SearchFilterBar";
import { SelectionLine } from "./SelectionLine";

const f = (p: Partial<FilterState>): FilterState => ({ ...NO_FILTERS, ...p });
const options: FilterOptions = {
  vendor: [{ value: "Hardman Design", label: "Hardman Design", count: 3 }],
  productType: [{ value: "Table", label: "Table", count: 2 }],
  tag: [{ value: "sale", label: "sale", count: 2 }],
  catalog: [{ value: "c1", label: "UK" }],
  collection: [{ value: "col1", label: "Sale" }],
  market: [{ value: "m1", label: "United Kingdom" }],
  locations: [{ value: "l1", label: "London" }],
  slots: [{ value: "fr", label: "French" }],
  metafields: [{ value: "custom.x", label: "Colour" }],
  pageSections: [{ key: "show", label: "Show", single: true, options: [{ value: "problem", label: "Problems" }] }],
};
const ALL = [...SECTION_ORDER];
const bar = (filters: FilterState, notes?: string[]) => renderToString(<SearchFilterBar filters={filters} onChange={() => undefined} sections={ALL} options={options} pageTitle="Availability" notes={notes} />);
const count = (html: string, text: string) => html.split(text).length - 1;

describe("search and filter bar", () => {
  it("has the search box with the standard placeholder and a Filters button next to it", () => {
    const html = bar(NO_FILTERS);
    expect(html).toContain("<s-search-field");
    expect(html).toContain(SEARCH_PLACEHOLDER);
    expect(SEARCH_PLACEHOLDER).toBe("Search by title, handle, SKU or any column");
    expect(html.indexOf("<s-search-field")).toBeLessThan(html.indexOf(">Filters<"));
  });
  it("shows no chips and no extra Clear all when no filter is on", () => {
    const html = bar(NO_FILTERS);
    expect(html).not.toContain("<s-clickable-chip");
    // The only "Clear all" is the popup's footer button.
    expect(count(html, "Clear all")).toBe(1);
  });
  it("shows Filters (n), one chip per value and Clear all when filters are on", () => {
    const html = bar(f({ status: ["ACTIVE"], tagNot: ["sale"] }));
    expect(html).toContain("Filters (2)");
    expect(html).toContain("Status: active");
    expect(html).toContain("Tag excluded: sale");
    expect(count(html, "<s-clickable-chip")).toBe(2);
    expect(count(html, "Clear all")).toBe(2);
    // Order: search box, then the Filters button, then the chips.
    expect(html.indexOf("<s-search-field")).toBeLessThan(html.indexOf("Filters (2)"));
    expect(html.indexOf("Filters (2)")).toBeLessThan(html.indexOf("Status: active"));
  });
  it("does not count the search text as a filter", () => {
    const html = bar(f({ search: "oak" }));
    expect(html).not.toContain("Filters (");
    expect(html).not.toContain("<s-clickable-chip");
  });
  it("puts the notes under the search box", () => {
    const html = bar(NO_FILTERS, ["12 products still loading"]);
    expect(html).toContain("12 products still loading");
    expect(html.indexOf("<s-search-field")).toBeLessThan(html.indexOf("12 products still loading"));
  });
});

describe("filter popup", () => {
  it("is an s-modal, closed on load, with Apply filters (primary) and Clear all (secondary) in the footer slots", () => {
    const html = bar(NO_FILTERS);
    expect(html).toContain("<s-modal");
    expect(html).toMatch(/<s-button[^>]*slot="primary-action"[^>]*variant="primary"[^>]*>Apply filters<|<s-button[^>]*variant="primary"[^>]*slot="primary-action"[^>]*>Apply filters</);
    expect(html).toMatch(/slot="secondary-actions"[^>]*>Clear all</);
    // Closed on load: the sections are not drawn at all.
    expect(html).not.toContain("Tag, does not have");
    expect(html).not.toContain("Market catalogue");
    // One primary button in the popup.
    expect(count(html, 'variant="primary"')).toBe(1);
  });
  it("closes with the commands the Polaris dialog expects", () => {
    const html = bar(NO_FILTERS);
    expect(html).toContain('command="--hide"');
    expect(html).toContain('command="--show"');
  });
  it("lists the sections in the standard order with the standard labels", () => {
    const html = renderToString(<FilterSections sections={ALL.filter((s) => s !== "price")} draft={NO_FILTERS} set={() => undefined} options={options} pageTitle="Availability" translationModes={["missing", "outdated", "complete"]} />);
    const labels = ["Status", "Vendor", "Product type", "Collection", "Tag, has", "Tag, does not have", "Market catalogue", "Published in market", "Stock", "Number of variants", "Translations", "Metafield", "This page only (Availability)"];
    let at = -1;
    for (const l of labels) {
      const i = html.indexOf(`<s-heading>${l}</s-heading>`);
      expect(i, l).toBeGreaterThan(at);
      at = i;
    }
  });
  it("shows only the sections a page asks for", () => {
    const html = renderToString(<FilterSections sections={["status", "tagNot"]} draft={NO_FILTERS} set={() => undefined} options={options} translationModes={[]} />);
    expect(html).toContain("<s-heading>Status</s-heading>");
    expect(html).toContain("<s-heading>Tag, does not have</s-heading>");
    expect(html).not.toContain("<s-heading>Vendor</s-heading>");
  });
  it("offers the any/all choice only for Tag, has, and only with several tags", () => {
    const one = renderToString(<FilterSections sections={["tag", "tagNot"]} draft={f({ tag: ["sale"], tagNot: ["a", "b"] })} set={() => undefined} options={options} translationModes={[]} />);
    expect(one).not.toContain("Any of the chosen");
    const two = renderToString(<FilterSections sections={["tag", "tagNot"]} draft={f({ tag: ["sale", "new"] })} set={() => undefined} options={options} translationModes={[]} />);
    expect(count(two, "Any of the chosen")).toBe(1);
  });
  it("offers only the translation modes the page can judge", () => {
    const html = renderToString(<FilterSections sections={["translations"]} draft={NO_FILTERS} set={() => undefined} options={options} translationModes={["missing", "complete"]} />);
    expect(html).toContain("Missing a translation");
    expect(html).toContain("Fully translated");
    expect(html).not.toContain("Outdated");
  });
});

describe("selection line", () => {
  const draw = (count: number, only: boolean) => renderToString(<SelectionLine count={count} onlySelected={only} onOnlySelected={() => undefined} onClear={() => undefined} />);
  it("shows nothing when no row is ticked", () => {
    expect(draw(0, false)).toBe("");
  });
  it("shows n selected, Show only selected and Clear selection", () => {
    const html = draw(13, false);
    expect(html).toContain("13 selected");
    expect(html).toContain("Show only selected");
    expect(html).toContain("Clear selection");
    expect(html).not.toContain("filters are ignored");
  });
  it("says the filters are ignored while Show only selected is on", () => {
    const html = draw(13, true);
    expect(html).toContain("Showing the 13 selected products (filters are ignored)");
    expect(html).toContain("13 selected");
  });
});
