import { PageBody } from "../components/PageBody";
import { useAppState } from "./state";

// Placeholder. Next step: one preview table of what will change, a ticked
// confirmation, the manual Sync button, and a list of anything that failed.
export default function Sync() {
  const { shop, ui, groups } = useAppState();
  const entries = Object.entries(ui.staged);
  const groupName = (id: string | null) => (id ? (groups.find((g) => g.id === id)?.name ?? "unknown group") : "General");

  return (
    <s-page heading={`Sync · ${shop.name}`} inlineSize="large">
      <PageBody>
        <s-stack gap="large-100">
          <s-section heading="Sync">
            {entries.length === 0 ? (
              <s-paragraph color="subdued">
                Nothing to sync yet. Stage some products on the Products page first.
              </s-paragraph>
            ) : (
              <s-stack gap="base">
                <s-paragraph>
                  {entries.length} product{entries.length === 1 ? " is" : "s are"} staged to move:{" "}
                  {[...new Set(entries.map(([, to]) => groupName(to)))].join(", ")}.
                </s-paragraph>
                <s-banner tone="info">
                  <s-paragraph>
                    Applying staged moves (shipping profiles and catalogues) is the next step to build. Nothing has
                    been changed in Shopify.
                  </s-paragraph>
                </s-banner>
              </s-stack>
            )}
          </s-section>
        </s-stack>
      </PageBody>
    </s-page>
  );
}
