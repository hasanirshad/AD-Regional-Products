import { onChecked } from "../../lib/dom";
import { onlySelectedNote } from "../../lib/filters/selection";

/**
 * Shown whenever rows are ticked: "n selected", the "Show only selected" box and "Clear selection".
 * With the box ticked the table shows only the ticked rows and ignores search and filters; the line says so.
 */
export function SelectionLine({
  count,
  onlySelected,
  onOnlySelected,
  onClear,
  thing = "product",
  children,
}: {
  count: number;
  onlySelected: boolean;
  onOnlySelected: (on: boolean) => void;
  onClear: () => void;
  /** What the rows are, singular ("product"). */
  thing?: string;
  /** Extra things that belong on this line (a cap such as "most 1,000"). */
  children?: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      {onlySelected ? <s-text type="strong">{onlySelectedNote(count, thing)}</s-text> : null}
      <s-text color="subdued">{`${count} selected`}</s-text>
      {children}
      <s-checkbox label="Show only selected" checked={onlySelected || undefined} ref={onChecked(onOnlySelected)} />
      <s-button onClick={onClear}>Clear selection</s-button>
    </s-stack>
  );
}
