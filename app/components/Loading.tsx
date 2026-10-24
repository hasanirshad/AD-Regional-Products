export function Loading({ message = "Loading…" }: { message?: string }) {
  return (
    <s-stack direction="inline" alignItems="center" gap="base">
      <s-spinner accessibilityLabel={message} />
      <s-text color="subdued">{message}</s-text>
    </s-stack>
  );
}
