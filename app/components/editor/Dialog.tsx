import { useEffect, type ReactNode } from "react";

/** A plain dialog over the page: a heading, a scrolling body and a footer for the buttons. Escape closes it. */
export function Dialog({
  heading,
  onClose,
  footer,
  children,
  maxWidth = 640,
}: {
  heading: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--p-color-bg-surface, #fff)",
          color: "var(--p-color-text, #303030)",
          borderRadius: 16,
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ padding: "16px 20px 8px" }}>
          <s-heading>{heading}</s-heading>
        </div>
        <div style={{ padding: "8px 20px", overflowY: "auto", flex: 1, minHeight: 0 }}>{children}</div>
        {footer ? <div style={{ padding: "8px 20px 16px" }}>{footer}</div> : null}
      </div>
    </div>
  );
}
