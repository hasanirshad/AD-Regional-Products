import type { ReactNode } from "react";
import { Loading } from "./Loading";
import { PageBody } from "./PageBody";

// Shows the page frame immediately, then loading or a plain error with
// "Try again", until the shared data is ready. Then the page.
export function Gate({
  status,
  error,
  onRetry,
  loadingMessage = "Loading your store…",
  children,
}: {
  status: "loading" | "error" | "ready";
  error?: string;
  onRetry: () => void;
  loadingMessage?: string;
  children: ReactNode;
}) {
  if (status === "ready") return <>{children}</>;

  return (
    <s-page heading="Regional Availability" inlineSize="large">
      <PageBody>
        {status === "loading" ? (
          <s-section>
            <Loading message={loadingMessage} />
          </s-section>
        ) : (
          <s-banner tone="critical" heading="Could not load your store">
            <s-paragraph>{error}</s-paragraph>
            <s-button slot="secondary-actions" onClick={onRetry}>
              Try again
            </s-button>
          </s-banner>
        )}
      </PageBody>
    </s-page>
  );
}
