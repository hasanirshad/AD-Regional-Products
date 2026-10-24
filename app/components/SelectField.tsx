import { onValue } from "../lib/dom";

export type SelectOption = { value: string; label: string };

// Polaris select with the native `change` event wired through our helper.
export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <s-select label={label} value={value} ref={onValue(onChange)}>
      {options.map((o) => (
        <s-option key={o.value} value={o.value}>
          {o.label}
        </s-option>
      ))}
    </s-select>
  );
}
