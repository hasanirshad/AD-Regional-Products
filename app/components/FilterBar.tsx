import { useEffect, useRef, useState, type ReactNode } from "react";
import { onInput, onRemove } from "../lib/dom";

/** How long typing must pause before the list is filtered. */
const SEARCH_PAUSE_MS = 250;

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
  // Typing is kept in this box and passed on after a short pause, so the table below is not redrawn on every key.
  const [text, setText] = useState(search);
  const sent = useRef(search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // A change that did not come from typing here (Clear all, a chip): show it.
    if (search !== sent.current) {
      sent.current = search;
      setText(search);
    }
  }, [search]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const type = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      sent.current = value;
      onSearch(value);
    }, SEARCH_PAUSE_MS);
  };
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
          value={text}
          ref={onInput(type)}
        />
        <s-button icon="filter" commandFor={popoverId}>
          {activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
        </s-button>
        {activeCount > 0 || search || text ? (
          <s-button
            variant="tertiary"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              sent.current = "";
              setText("");
              onClear();
            }}
          >
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
