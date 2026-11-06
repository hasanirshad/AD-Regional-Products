import { memo } from "react";
import { onRemove } from "../../lib/dom";
import type { FilterChip } from "../../lib/filters/filterModel";

/** One removable chip per chosen value, and "Clear all". Nothing at all when no filter is on. */
export const FilterChips = memo(function FilterChips({ chips, onRemoveChip, onClear }: { chips: FilterChip[]; onRemoveChip: (chip: FilterChip) => void; onClear: () => void }) {
  if (chips.length === 0) return null;
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center">
      {chips.map((c) => (
        <s-clickable-chip key={c.key} removable ref={onRemove(() => onRemoveChip(c))}>
          {c.label}
        </s-clickable-chip>
      ))}
      <s-button variant="tertiary" onClick={onClear}>
        Clear all
      </s-button>
    </s-stack>
  );
});
