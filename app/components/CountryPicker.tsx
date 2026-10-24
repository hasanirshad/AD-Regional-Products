import { useMemo, useState } from "react";
import { onChecked, onInput } from "../lib/dom";
import type { CountryOption } from "../lib/countries";

// Search box + a grid of checkboxes. The caller decides which countries are
// offered (the ones the store sells to or ships to).
export function CountryPicker({
  options,
  selected,
  onChange,
}: {
  options: CountryOption[];
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const chosen = useMemo(() => new Set(selected), [selected]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase() === q);
  }, [options, query]);

  const toggle = (code: string, on: boolean) => {
    if (on) onChange([...new Set([...selected, code])]);
    else onChange(selected.filter((c) => c !== code));
  };

  return (
    <s-stack gap="base">
      <s-search-field
        label="Search countries"
        labelAccessibilityVisibility="exclusive"
        placeholder="Search countries"
        value={query}
        ref={onInput(setQuery)}
      />
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-text color="subdued">
          {selected.length} selected · {shown.length} of {options.length} shown
        </s-text>
        {selected.length > 0 ? (
          <s-button variant="tertiary" onClick={() => onChange([])}>
            Clear selection
          </s-button>
        ) : null}
      </s-stack>
      {shown.length === 0 ? (
        <s-paragraph color="subdued">No countries match this search.</s-paragraph>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: 8,
            maxHeight: 320,
            overflowY: "auto",
            minWidth: 0,
          }}
        >
          {shown.map((o) => (
            <s-checkbox
              key={o.code}
              label={`${o.name} (${o.code})`}
              checked={chosen.has(o.code) || undefined}
              ref={onChecked((on) => toggle(o.code, on))}
            />
          ))}
        </div>
      )}
    </s-stack>
  );
}
