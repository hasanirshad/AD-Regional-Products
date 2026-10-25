import { onValue } from "../lib/dom";

export type SelectOption = { value: string; label: string };

// Polaris select with the native `change` event wired through our helper.
export function SelectField({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Keep the label for screen readers only (for selects inside table rows). */
  hideLabel?: boolean;
}) {
  return (
    <s-select label={label} labelAccessibilityVisibility={hideLabel ? "exclusive" : undefined} value={value} ref={onValue(onChange)}>
      {options.map((o) => (
        <s-option key={o.value} value={o.value}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}
