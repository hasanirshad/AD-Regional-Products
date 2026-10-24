import type { ReactNode } from "react";
import { onInput, onRemove } from "../lib/dom";

// The playbook's filter bar: search field + Filters popover + Clear all,
// with the active filters as removable chips underneath.
export function FilterBar({
  search,
  onSearch,
  placeholder,
  activeCount,
  chips,
  onRemoveChip,
  onClear,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  /** Number of active filters (not counting the search text). */
  activeCount: number;
  chips: { key: string; label: string }[];
  onRemoveChip: (key: string) => void;
  onClear: () => void;
  /** The filter fields inside the popover. */
  children: ReactNode;
}) {
  const popoverId = "filters-popover";
  return (
    <s-stack gap="base">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto auto",
          gap: 8,
          alignItems: "center",
        }}
      >
        <s-search-field
          label="Search"
          labelAccessibilityVisibility="exclusive"
          placeholder={placeholder}
          value={search}
          ref={onInput(onSearch)}
        />
        <s-button icon="filter" commandFor={popoverId}>
          {activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
        </s-button>
        {activeCount > 0 || search ? (
          <s-button variant="tertiary" onClick={onClear}>
            Clear all
          </s-button>
        ) : (
          <span />
        )}
      </div>

      <s-popover id={popoverId}>
        <s-stack gap="base">
          {children}
          <s-button variant="primary" command="--hide" commandFor={popoverId}>
            Done
          </s-button>
        </s-stack>
      </s-popover>

      {chips.length > 0 ? (
        <s-stack direction="inline" gap="small-200">
          {chips.map((c) => (
            <s-clickable-chip key={c.key} removable ref={onRemove(() => onRemoveChip(c.key))}>
              {c.label}
            </s-clickable-chip>
          ))}
        </s-stack>
      ) : null}
    </s-stack>
  );
}
