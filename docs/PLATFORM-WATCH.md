# Platform watch: what Shopify changed and what the apps do about it

Checked 2026-10-29 against Shopify's developer changelog. Update this file when Shopify moves a date.

## Per-market shipping (affects the groups = shipping profiles)

- From API 2026-07 shipping can live on a market (`Market.delivery.shipping`, written with `marketUpdate`; scopes read_markets / write_markets).
- Merchant-owned `deliveryProfile*` APIs are deprecated for shops on market-driven shipping. **Reads may be a stale snapshot, and writes can succeed
  without changing live shipping.** App-owned profiles are not affected. Detect with `shop.features.marketDrivenShipping`.
- Rollout: existing merchants can opt in from 2026-10-01; everyone is moved and the legacy APIs are deprecated on 2027-07-01.
- Our groups ARE merchant delivery profiles, so on an opted-in shop the move flow and the country fix would "succeed" and do nothing.
- Done: `app/lib/shippingMode.ts`. `applyMove` and `runCountryFix` check the flag first and stop without writing; the layout shows a banner.
  An unreadable flag is "unknown" and does not block. Tests: `shippingMode.test.ts`.
- Not done (needs a design decision and a market-driven test store): reading groups from `Market.delivery` and moving products through market conditions.
  Until then, groups keep working only while the store is not on market-driven shipping.

## Returns per market

- `Market.returnPolicyProfile` and `returnPolicyProfiles` exist from API **2026-10**, read-only, scope **read_legal_policies** (new).
  `returnRules` null = unrestricted; `canAcceptReturns`, `returnWindowDays` (-1 = unlimited). A market with no profile uses the store default.
- Done: Market availability block shows a Returns column and a Shipping column (On / Off / Inherited), read-only, each from its own soft query.
  Without the new permission the block says so and still shows everything else. `read_legal_policies` is added to `shopify.app.production.toml`:
  **needs `npm run deploy` and approval in the store.**

## Not available yet (nothing built)

- Activity log API: none. `events` (1 year) has no staff or app actor, so Recent activity keeps today's events.
- Cart preview per market: no documented URL pattern. Quick links keeps the market domain links and the theme preview link.
- A list of new Polaris components: none published in the sources checked. Polaris 2.0 is stable (2026-10-22); see the audit.

## Fall '26 audit (report only; nothing changed)

| Item | Regional Products | AD MetaFields | AD Regional Discounts |
|---|---|---|---|
| Script tags | none | none (not seen in config) | none (not seen in config) |
| Token | online token, browser direct API, nothing stored | same | same in the toml; but `app/shopify.server.ts` is an unused template with Prisma + `AppDistribution.AppStore` |
| Expiring-token rule | not affected (custom, online token) | not affected | not affected; the unused template already sets `expiringOfflineAccessTokens: true` |
| Admin API version | app 2026-07, blocks 2026-10 | 2026-10 | **2027-01** (a release candidate) |
| Polaris script | `polaris.js` = Polaris 1.1, types `^2.0.0` (mismatch) | `polaris.js` in template, types `^2.0.0` | `polaris.js`, types `^1.0.1` |
| CLI | `^4.9.4` (5.0.0 is latest) | `latest` | see package.json |

- CLI: `shopify app logs` exists (streams logs); `shopify app security` also exists. I could not confirm a separate "production logs" command.
- 2026-10 changes that touch us: `ProductVariant.barcode` is deprecated (use `barcodes`; Bulk SKU/barcode columns still read `barcode`);
  invalid metafield filters now return errors (Bulk "empty metafield" filter); `Metafield.translatable` is non-null (AD MetaFields reads it);
  `carrierServiceCreate` no longer adds rates to the General profile (not used).
