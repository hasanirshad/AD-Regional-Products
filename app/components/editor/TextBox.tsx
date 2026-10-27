import { useCallback, useEffect, useRef, useState } from "react";

/** Typing is kept in the box and passed on after a short pause (and on leaving the box), so the page is not redrawn on every key. */
const PAUSE_MS = 200;

type Field = HTMLElement & { value?: string };

export function TextBox({
  label,
  value,
  onChange,
  multiline,
  rows,
  error,
  placeholder,
  disabled,
  details,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  multiline?: boolean;
  rows?: number;
  error?: string | null;
  placeholder?: string;
  disabled?: boolean;
  details?: string;
  /** Keep the label for screen readers only. */
  hideLabel?: boolean;
}) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // A change that did not come from typing here (Undo, a copy, a discard) is shown straight away.
  useEffect(() => {
    if (value !== sent.current && value.trim() !== latest.current.trim()) {
      sent.current = value;
      latest.current = value;
      setText(value);
    }
  }, [value]);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (latest.current !== sent.current) {
      sent.current = latest.current;
      onChangeRef.current(latest.current);
    }
  }, []);

  useEffect(() => flush, [flush]);

  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback(
    (el: Field | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!el) return;
      const onInput = () => {
        latest.current = el.value ?? "";
        setText(latest.current);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, PAUSE_MS);
      };
      el.addEventListener("input", onInput);
      el.addEventListener("change", flush);
      cleanup.current = () => {
        el.removeEventListener("input", onInput);
        el.removeEventListener("change", flush);
      };
    },
    [flush],
  );

  const common = {
    label,
    labelAccessibilityVisibility: hideLabel ? ("exclusive" as const) : undefined,
    value: text,
    placeholder,
    error: error || undefined,
    details,
    disabled: disabled || undefined,
  };
  return multiline ? <s-text-area {...common} rows={rows ?? 4} ref={ref} /> : <s-text-field {...common} ref={ref} />;
}
