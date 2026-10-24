import type { ReactNode } from "react";

// Centred max-width wrapper (playbook 2.2). On wide screens the space around
// grows, never the boxes.
export function PageBody({
  children,
  maxWidth = 1040,
}: {
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth,
        marginInline: "auto",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}
