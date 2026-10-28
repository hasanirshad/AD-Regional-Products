# Product Insights blocks (added 2026-10-27)

> **Update 2026-10-28:** the blocks now read their settings from the app (page "Block settings", see `docs/BLOCK-SETTINGS.md`). The values in
> `constants.ts` below are the **defaults** used when nothing is saved or a saved value is broken. To change a market domain, the
> preview theme, the lead-time keys, the badge or the languages, use the Block settings page; no code change and no redeploy.

Seven **read-only** admin blocks for the product details page. Each is its own extension, so each can be added or removed
from "+ Block" on the product page. No server, no routes, no writes: every block calls the Admin GraphQL API straight from
the extension (`shopify.query`). A query that starts with `mutation` is refused in `extensions/shared/graphql.ts`, and a test
checks that no block sends one. Links only, no buttons.

| Block (name in "+ Block") | Folder | Shows |
|---|---|---|
| Market Availability | `market-availability` | FR, DE, NL, CH, UK, US: published or not, price in the market currency, compare-at. Not-published markets are flagged. |
| Translation Status | `translation-status` | Per language: title, description, SEO title, SEO description, handle, `custom` metafields, option names and values as Translated / Missing / Same as source. |
| Sale and Badge | `sale-badge` | Compare-at vs price and the discount % per market, `custom.sale_badge` and its translations, sale collection membership. |
| Data Quality Checklist | `data-quality` | Pass/fail list with a reason on each failure and a count ("6 of 7 passed"). |
| Collections and Tags | `collections-tags` | Every collection (Manual / Automated, link to its admin page) and all tags. |
| Quick Links | `quick-links` | Product on each storefront domain (`?stay_us=1` on US), preview theme link, orders list filtered to the product. |
| Recent Activity | `recent-activity` | Last updated time and the latest product timeline events with the app that made them. |

## Where things are

```
extensions/
  tsconfig.json, globals.d.ts      Preact JSX + the `shopify` global (own typecheck: tsc -p extensions)
  shared/
    constants.ts                   the DEFAULT store-specific values (the Block settings page overrides them)
    settings.ts                    settings shape, defaults, value rules, parser and the reader the blocks use (pure)
    query.ts, pure.ts              query wrapper and query helpers without the `shopify` global (the app imports them too)
    graphql.ts                     re-exports query.ts + the `shopify` global; query.ts: read-only guard, throttle retry, plain error messages
    pricing.ts                     price per market (Product.contextualPricing, with a variants fallback)
    collections.ts, translations.tsx, admin.ts, format.ts
    ui.tsx                         defineBlock + loading / error / empty states + small components
  <block>/shopify.extension.toml   target admin.product-details.block.render, api_version 2026-10
  <block>/src/logic.ts             queries + shaping (pure, tested)   <block>/src/Block.tsx   the view
  testkit/fake.ts, blocks.test.tsx fake Shopify + tests for every block
scripts/check-extensions.mjs       `npm run check:extensions`: builds each block, 64 KB limit, unique handle/uid/name
```

## Scopes

Only one is new. The app config (`shopify.app.production.toml`) now has `read_translations` added; nothing else changed.

| Scope | Why | New? |
|---|---|---|
| `read_products` | product, variants, media, metafields, collections, tags, events, prices | already there |
| `read_markets` | markets and their catalogues | already there |
| `read_publications` | which market catalogues the product is published in | already there |
| `read_translations` | `translatableResource` / `translatableResourcesByIds` (Translation Status, badge translations) | **new** |

No write scope was added. Direct API access (`[access.admin] direct_api_mode = "online"`) was already on.

## Constants (`extensions/shared/constants.ts`): the defaults

Lines marked CONFIRM are my best guess and must be checked:

- `MARKETS`: country and storefront domain per market (from the Hardman notes: hardmandesigns.com UK, hardmandesign.com US, hardmandesign.de/.fr/.ch/.nl). `marketHandle` only if two markets share a country.
- `LANGUAGES`: fr, de, nl.
- `SALE_COLLECTION_HANDLE`: `sale` (guess).
- `PREVIEW_THEME_ID`: empty, so the preview link is hidden until you enter the numeric theme id. `PREVIEW_MARKET_KEY` picks the domain it uses.
- `REQUIRED_FIELDS.length` / `.seater`: `custom.variant_length` and `custom.variant_table_person_space` (variant level), taken from the collection page code. **Confirm that these are the right "length" and "seater" fields.**
- `REQUIRED_FIELDS.leadTime`: **empty, keys not known**. The check shows "Not configured" and is left out of the count until you add them.
- `TRANSLATED_METAFIELD_NAMESPACES`: `custom`.
- `SALE_BADGE`: `custom.sale_badge`. `EVENTS_LIMIT`: 20.

## What the API cannot give

- **Staff names.** Product events say whether a staff member or an app made the change and name the app, never the person.
- **Price changes.** Not part of the product events. Recent Activity says so instead of guessing.
- **Prices per market** come from the lowest- and highest-priced variant (`Product.contextualPricing`). Compare-at is the one on those two variants. If Shopify refuses that field the block falls back to the first 30 variants and says so.

Limits: 50 metafields per namespace, 100 variants per page (up to 500), 50 media files, 1,000 collections, 20 events. A block says so when it hits one.

## Deploy (existing invite-only setup)

1. Run the checks and push (Cloudflare builds the app as before):
   `npm install`, `npm run typecheck`, `npm test`, `npm run check:extensions`, then commit and push.
2. `npm run deploy` (`shopify app deploy --config production`). This releases the seven extensions and the new scope together.
3. **Scope approval: yes, one prompt.** Shopify asks a store owner/admin to approve the added scope the next time someone opens the app in the Hardman admin ("Merchants are prompted to approve the updated access scopes when they open your app"). Open AD Regional Products once and approve. Until then the blocks that need `read_translations` show a plain "needs the read_translations permission" message and the others work.
4. On a product page choose **+ Block**, add the seven blocks and pin them. Each block only appears after step 2.

## Test on the Hardman store (nothing has run against the real store yet)

Use two products: one published in all six markets and one that is not (for example unpublished from FR/CH).

- Market Availability: the second product must show the right market(s) red with "Not published in …". Prices should match the market price lists.
- Translation Status: pick a product you know is half translated.
- Sale and Badge: a sale product with a badge, and a normal one.
- Data Quality: the product with the known gaps should fail the same checks you see by eye.
- Quick Links: open each link; check `?stay_us=1` on US. Check the orders link filters to the product.
- Recent Activity: the newest event should match the product's own Timeline.

## Not verified (cannot be checked from the cloud)

- No query has run against Shopify's schema. The code compiles, the real Shopify CLI builds all seven (`shopify app build`), 47 tests run each block against a fake Shopify, and a browser smoke run mounts blocks with a stub `shopify` global. The queries and the `s-*` components render only inside the admin.
- Least certain: `Product.contextualPricing` (has a fallback), the orders link `orders?query=product_id:<id>`, absolute `admin.shopify.com` links opening from a block.
- If any block shows "Shopify did not recognise part of this block's request", copy the message under the banner's block name to the developer: the failing field is in `error.detail`.
