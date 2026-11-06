import { memo, useCallback, useMemo, useRef } from "react";
import { onInput } from "../../lib/dom";
import { clearAll, describeChips, countActive, type FilterChip, type FilterNames, type FilterState, type SectionId } from "../../lib/filters/filterModel";
import { FilterChips } from "./FilterChips";
import { FilterPopup, popupNames, type FilterOptions, type PopupConfig } from "./FilterPopup";
import { useTypedSearch } from "./useTypedSearch";

export const SEARCH_PLACEHOLDER = "Search by title, handle, SKU or any column";

export type SearchFilterBarProps = {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  /** The sections of the popup this page uses (they are always shown in the standard order). */
  sections: SectionId[];
  options: FilterOptions;
  /** The page's name, for the "This page only" section. */
  pageTitle?: string;
  /** Which translation filters the page can judge (default: all). */
  translationModes?: PopupConfig["translationModes"];
  /** Lines under the search box: "n products still loading", "n products waiting for stock". */
  notes?: string[];
  /** Names of ids for the chips; filled in from the options when left out. */
  names?: FilterNames;
  /** Called each time the popup opens (the page starts reading things only the popup needs, such as the collections). */
  onOpen?: () => void;
};

/**
 * THE search and filter bar. In order: the search box with the Filters button next to it, notes under the box,
 * the removable chips with "Clear all". The popup holds every filter of the page. The selection line and the table go below.
 */
export const SearchFilterBar = memo(function SearchFilterBar({ filters, onChange, sections, options, pageTitle, translationModes, notes, names, onOpen }: SearchFilterBarProps) {
  // The pause before a typed search is applied must not overwrite a filter chosen in the meantime.
  const latest = useRef(filters);
  latest.current = filters;
  const onSearch = useCallback((search: string) => onChange({ ...latest.current, search }), [onChange]);
  const { text, type, reset } = useTypedSearch(filters.search, onSearch);

  const chipNames = useMemo<FilterNames>(() => names ?? popupNames(options), [names, options]);
  const chips = useMemo(() => describeChips(filters, chipNames), [filters, chipNames]);
  const active = countActive(filters);

  const clear = useCallback(() => {
    reset();
    onChange(clearAll());
  }, [onChange, reset]);
  const removeChip = useCallback((c: FilterChip) => onChange(c.remove(latest.current)), [onChange]);
  // Apply keeps what is typed in the search box.
  const apply = useCallback((next: FilterState) => onChange({ ...next, search: latest.current.search }), [onChange]);

  return (
    <s-stack gap="small-200">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
        <s-search-field label="Search" labelAccessibilityVisibility="exclusive" placeholder={SEARCH_PLACEHOLDER} value={text} ref={onInput(type)} />
        <FilterPopup filters={filters} active={active} onApply={apply} onClear={clear} onOpen={onOpen} sections={sections} options={options} pageTitle={pageTitle} translationModes={translationModes} />
      </div>
      {notes?.map((n) => (
        <s-text key={n} color="subdued">
          {n}
        </s-text>
      ))}
      <FilterChips chips={chips} onRemoveChip={removeChip} onClear={clear} />
    </s-stack>
  );
});
