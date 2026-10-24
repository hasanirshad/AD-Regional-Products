import { countryName, summarizeCodes } from "../lib/countries";
import type { MarketResult, ProfilePlan } from "../lib/types";

// Shows, before anything is written: the shipping zones and rates the group's
// profile will get, anything that could not be copied, and what the allowed
// countries mean for each market.
export function PlanPreview({
  plan,
  markets,
}: {
  plan: ProfilePlan;
  markets: MarketResult[];
}) {
  const zones = plan.locationGroups.flatMap((lg) =>
    lg.zones.map((z) => ({ zone: z, origin: lg.locationNames.join(", ") })),
  );
  const multipleOrigins = plan.locationGroups.length > 1;

  return (
    <s-stack gap="large-100">
      {plan.warnings.map((w) => (
        <s-banner key={w} tone="warning">
          <s-paragraph>{w}</s-paragraph>
        </s-banner>
      ))}

      <s-section heading="Shipping profile preview">
        {zones.length === 0 ? (
          <s-paragraph color="subdued">
            Nothing would be created yet. Choose countries that General ships to.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Zone</s-table-header>
              <s-table-header>Countries</s-table-header>
              <s-table-header>Rates copied</s-table-header>
              <s-table-header>Not copied</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {zones.map(({ zone, origin }, i) => (
                <s-table-row key={`${zone.name}-${i}`}>
                  <s-table-cell>
                    {zone.name}
                    {multipleOrigins ? (
                      <>
                        <br />
                        <s-text color="subdued">From {origin}</s-text>
                      </>
                    ) : null}
                  </s-table-cell>
                  <s-table-cell>
                    {summarizeCodes(
                      zone.countries.map((c) => c.code ?? ""),
                      6,
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {zone.methods.map((m) => m.name).join(", ") || "—"}
                  </s-table-cell>
                  <s-table-cell>
                    {zone.skipped.length === 0 ? (
                      "—"
                    ) : (
                      zone.skipped.map((s) => (
                        <div key={s.name}>
                          <s-badge tone="warning">{s.name}</s-badge>{" "}
                          <s-text color="subdued">{s.reason}</s-text>
                        </div>
                      ))
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="What this means for your markets">
        {markets.length === 0 ? (
          <s-paragraph color="subdued">No active markets with countries were found.</s-paragraph>
        ) : (
          <s-stack gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header>Market</s-table-header>
                <s-table-header>Products</s-table-header>
                <s-table-header>Details</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {markets.map((r) => (
                  <s-table-row key={r.market.id}>
                    <s-table-cell>{r.market.name}</s-table-cell>
                    <s-table-cell>
                      {r.state === "all" ? (
                        <s-badge tone="success">Published</s-badge>
                      ) : r.state === "none" ? (
                        <s-badge tone="neutral">Hidden</s-badge>
                      ) : (
                        <s-badge tone="warning">Mixed</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {r.state === "all" && "All countries in this market are allowed."}
                      {r.state === "none" && "No country in this market is allowed."}
                      {r.state === "mixed" &&
                        `Stays visible. Checkout blocks ${r.blocked.map((c) => countryName(c.code)).join(", ")}.`}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-text color="subdued">
              Saving a group does not change your markets. Visibility is set when you move products on the Products page, after a review.
            </s-text>
          </s-stack>
        )}
      </s-section>
    </s-stack>
  );
}
