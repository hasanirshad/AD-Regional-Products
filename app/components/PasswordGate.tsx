import { useCallback, useEffect, useState, type ReactNode } from "react";
import { checkPassword, runUnlocked } from "../lib/guard";

type Pending = { action: () => Promise<void> | void };

/**
 * Asks for the password before any change. Usage:
 *
 *   const guard = useGuard();
 *   <s-button onClick={() => guard.ask(save)}>Save</s-button>
 *   {guard.modal}
 *
 * `ask` shows the dialog; after the right password, `action` runs with writes
 * allowed. Reads never need it.
 */
export function useGuard(): { ask: (action: () => Promise<void> | void) => void; modal: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback((action: () => Promise<void> | void) => setPending({ action }), []);
  const close = useCallback(() => setPending(null), []);
  const confirm = useCallback(async () => {
    const p = pending;
    setPending(null);
    if (p) await runUnlocked(p.action);
  }, [pending]);

  return { ask, modal: pending ? <PasswordDialog onCancel={close} onConfirm={confirm} /> : null };
}

function PasswordDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [el, setEl] = useState<(HTMLElement & { value?: string }) | null>(null);
  const fieldRef = useCallback((node: HTMLElement | null) => setEl(node), []);

  // Native listener: React 18 forwards only click and input from custom elements.
  useEffect(() => {
    if (!el) return;
    el.focus?.();
    const onInput = () => {
      setValue(el.value ?? "");
      setWrong(false);
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, [el]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async () => {
    if (!value || busy) return;
    setBusy(true);
    if (await checkPassword(value)) {
      await onConfirm();
    } else {
      setWrong(true);
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") void submit();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--p-color-bg-surface, #fff)",
          color: "var(--p-color-text, #303030)",
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
        }}
      >
        <s-stack gap="base">
          <s-heading id="pw-title">Password required</s-heading>
          <s-text color="subdued">This changes your store or saved data. Enter the password to continue.</s-text>
          <s-password-field label="Password" ref={fieldRef} />
          {wrong ? <s-text tone="critical">Wrong password.</s-text> : null}
          <s-stack direction="inline" gap="small-100" justifyContent="end">
            <s-button onClick={onCancel}>Cancel</s-button>
            <s-button variant="primary" disabled={!value || busy || undefined} onClick={() => void submit()}>
              Continue
            </s-button>
          </s-stack>
        </s-stack>
      </div>
    </div>
  );
}
