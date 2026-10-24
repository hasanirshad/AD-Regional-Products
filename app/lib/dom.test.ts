import { describe, expect, it, vi } from "vitest";
import { onChecked, onInput, onRemove, onValue, onValues } from "./dom";

function fakeElement<T extends object>(props: T) {
  return Object.assign(new EventTarget(), props);
}

describe("dom helpers", () => {
  it("onValue reads value on change", () => {
    const set = vi.fn();
    const el = fakeElement({ value: "a" });
    onValue(set)(el);
    el.value = "b";
    el.dispatchEvent(new Event("change"));
    expect(set).toHaveBeenCalledWith("b");
  });

  it("onInput reads value on every input event", () => {
    const set = vi.fn();
    const el = fakeElement({ value: "" });
    onInput(set)(el);
    el.value = "ab";
    el.dispatchEvent(new Event("input"));
    expect(set).toHaveBeenCalledWith("ab");
  });

  it("onChecked reads checked on change", () => {
    const set = vi.fn();
    const el = fakeElement({ checked: false });
    onChecked(set)(el);
    el.checked = true;
    el.dispatchEvent(new Event("change"));
    expect(set).toHaveBeenCalledWith(true);
  });

  it("onValues copies the selected values", () => {
    const set = vi.fn();
    const el = fakeElement({ values: ["x", "y"] });
    onValues(set)(el);
    el.dispatchEvent(new Event("change"));
    expect(set).toHaveBeenCalledWith(["x", "y"]);
  });

  it("onRemove fires on remove", () => {
    const handler = vi.fn();
    const el = fakeElement({});
    onRemove(handler)(el);
    el.dispatchEvent(new Event("remove"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("re-binding on re-render replaces the old listener instead of stacking", () => {
    const first = vi.fn();
    const second = vi.fn();
    const el = fakeElement({ value: "v" });
    onValue(first)(el);
    onValue(second)(el);
    el.dispatchEvent(new Event("change"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores a null element (unmount)", () => {
    expect(() => onValue(vi.fn())(null)).not.toThrow();
  });
});
