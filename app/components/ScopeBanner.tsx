import type { ProductScope } from "../views/products-state";

// First load reads active products only (quick). One button reads everything.
export function ScopeBanner({
  scope,
  count,
  onChange,
}: {
  scope: ProductScope;
  count: number;
  onChange: (scope: ProductScope) => void;
}) {
  return (
    <s-banner tone="info">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-text>
          {scope === "active"
            ? `Showing active products only (${count}).`
            : `Showing all products, including drafts and archived (${count}).`}
        </s-text>
        <s-button onClick={() => onChange(scope === "active" ? "all" : "active")}>
          {scope === "active" ? "Include drafts and archived" : "Active products only"}
        </s-button>
      </s-stack>
    </s-banner>
  );
}
