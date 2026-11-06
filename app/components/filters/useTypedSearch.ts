import { useEffect, useRef, useState } from "react";

/** How long typing must pause before the list is filtered. */
export const SEARCH_PAUSE_MS = 250;

/**
 * Typing is kept in a local box and passed on after a short pause, so the list below is not redrawn on every key.
 * A change that did not come from typing (Clear all, a chip) is shown straight away.
 */
export function useTypedSearch(search: string, onSearch: (value: string) => void) {
  const [text, setText] = useState(search);
  const sent = useRef(search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
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
  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    sent.current = "";
    setText("");
  };
  return { text, type, reset };
}
