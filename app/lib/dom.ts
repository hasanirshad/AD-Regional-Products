// React 18 only forwards `click` and `input` from custom elements (playbook
// gotcha 1). `change`, `remove` and similar never fire through JSX props.
// These helpers are used as `ref` callbacks and attach native listeners:
//
//   <s-select ref={onValue(setX)}>
//   <s-checkbox ref={onChecked(setY)} />
//   <s-clickable-chip removable ref={onRemove(removeThis)} />

const cleanups = new WeakMap<object, () => void>();

function bind<T extends EventTarget>(
  event: string,
  handle: (el: T, e: Event) => void,
) {
  return (el: T | null) => {
    if (!el) return;
    // The ref callback runs again on every render: replace the old listener.
    cleanups.get(el)?.();
    const listener = (e: Event) => handle(el, e);
    el.addEventListener(event, listener);
    cleanups.set(el, () => el.removeEventListener(event, listener));
  };
}

type WithValue = EventTarget & { value?: string };
type WithChecked = EventTarget & { checked?: boolean };
type WithValues = EventTarget & { values?: string[] };

/** s-text-field, s-search-field: the value on every keystroke (`input`). */
export const onInput = (set: (value: string) => void) =>
  bind<WithValue>("input", (el) => set(el.value ?? ""));

/** s-select, s-text-field, s-search-field: the current `value` (`change`). */
export const onValue = (set: (value: string) => void) =>
  bind<WithValue>("change", (el) => set(el.value ?? ""));

/** s-checkbox, s-switch: the current `checked` state. */
export const onChecked = (set: (checked: boolean) => void) =>
  bind<WithChecked>("change", (el) => set(Boolean(el.checked)));

/** s-choice-list with multiple choices: the selected `values`. */
export const onValues = (set: (values: string[]) => void) =>
  bind<WithValues>("change", (el) => set(Array.isArray(el.values) ? [...el.values] : []));

/** s-clickable-chip with `removable`: the remove button was used. */
export const onRemove = (handler: () => void) =>
  bind<EventTarget>("remove", () => handler());
