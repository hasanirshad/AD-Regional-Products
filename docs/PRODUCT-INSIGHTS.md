# Product Insights blocks (added 2026-10-27)

> **Update 2026-10-28:** the blocks now read their settings from the app (page "Block settings", see `docs/BLOCK-SETTINGS.md`). The values in
> `constants.ts` below are the **defaults** used when nothing is saved or a saved value is broken. To change a market domain, the
> preview theme, the lead-time keys, the badge or the languages, use the Block settings page; no code change and no redeploy.

> **Update 2026-10-29 (blocks upgrade):** now **eleven** blocks. New: Product health, Storefront readiness, Options and swatches, Content snapshot.
> Data quality, Market availability and Sale and badge were upgraded. See "Blocks upgrade (2026-10-29)" at the end of this file. Everything
> below about reading, the read-only guard and the 64 KB limit still holds.

Seven **read-only** admin blocks for the product details page (the original set; four more were added, see the update above). Each is its own extension, so each can be added or removed
from "+ Block" on the product page. No server, no routes, no writes: every block calls the Admin GraphQL API straight from
the extension (`shopify.query`). A query that starts with `mutation` is refused in `extensions/shared/graphql.ts`, and a test
checks that no block sends one. Links only, no buttons.

| Block (name in "+ Block") | Folder | Shows |
|---|---|---|
| Market Availability | `market-availability` | FR, DE, NL, CH, UK, US: published or not, price in the market currency, compare-at. Not-published markets are flagged. |
| Translation Status | `translation-status` | Per language: title, description, SEO title, SEO description, handle, `custom` metafields, option names and values as Translated / Missing / Same as source. |
| Sale and Badge | `sale-badge` | Compare-at vs price and the discount % per market, `custom.sale_badge` and its translations, sale collection membership. |
| Data Quality Checklist | `data-quality` | Detailed view behind Product health: checks grouped (Basics, SEO, Images, Variants and pricing, Theme fields, Markets, Linked records), each pass / fail / not applicable with a reason. |
| Collections and Tags | `collections-tags` | Every collection (Manual / Automated, link to its admin page) and all tags. |
| Quick Links | `quick-links` | Product on each storefront domain (`?stay_us=1` on US), preview theme link, orders list filtered to the product. |
| Recent Activity | `recent-activity` | Last updated time and the latest product timeline events with the app that made them. |
| Product health | `product-health` | Score out of 100, one-line verdict, count per level, and the pending list (Blocks storefront / Hurts SEO or sales / Nice to have) with the exact field and an admin link. Top 5, "Show all". |
| Storefront readiness | `storefront-readiness` | One row per market with a green / amber / red dot: published, price above zero, translated title / description / SEO, language adaptation, delivery time, preview link. |
| Options and swatches | `options-swatches` | Option values with swatch record, group, group key, priority, 3D model; flags; hidden-in-a-market; variants without weight or SKU (top 10). |
| Content snapshot | `content-snapshot` | Numbers only: title length, SEO lengths with a bar to 60 / 160, body words, images and alt coverage, tag line, wood and material, related / recommended counts, dimensions. |

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

The upgrade of 2026-10-29 adds two read scopes (`read_metaobjects`, `read_metaobject_definitions`); run `npm run deploy` and approve them in the store. Until then the linked-record checks say "could not be read. They need the metaobject permission." and everything else works.

| Scope | Why | New? |
|---|---|---|
| `read_products` | product, variants, media, metafields, collections, tags, events, prices | already there |
| `read_markets` | markets and their catalogues | already there |
| `read_publications` | which market catalogues the product is published in | already there |
| `read_translations` | `translatableResource` / `translatableResourcesByIds` (Translation Status, badge translations) | already added (2026-10-27) |
| `read_metaobjects` | the swatch, delivery-time and design records a product points to (Product health, Data quality, Options and swatches, Storefront readiness) | **new 2026-10-29** |
| `read_metaobject_definitions` | the Settings page, "Detect from this store": metaobject types of the store | **new 2026-10-29** |

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


---

# Blocks upgrade (2026-10-29)

Goal: each block shows real facts about THIS product, catches content problems and lists what is still pending, with few settings and smart
defaults from the store. All rules from before stay: blocks are read only, no server or database, no automatic translation, a password only
when SAVING settings, no push to master without Hasan's go-ahead.

## One engine, shared by the blocks

```
extensions/shared/
  healthSettings.ts   vocabulary (groups, profiles, levels), RULE_CATALOGUE, defaults, value rules for the five new settings sections
  facts.ts            THE reader of facts about a product (loadFacts(ctx, Need)): asks only for what a block needs
  markets.ts          THE reader of market publication: Market availability and Storefront readiness both use it, so they never disagree
  records.ts          linked records (swatch / design) and the delivery-time records (metaobjects)
  rules.ts            pure engine: detectProfile, evaluateHealth -> results, pending, counts, score, verdict; compareAtIssues (also used by Sale and badge)
  healthLoad.ts       loadHealth(ctx): facts + settings + markets + records for Product health and Data quality
  healthView.tsx      the shared pieces: profile bar, count strip, pending list (top 5 + "Show all")
extensions/testkit/health.ts   fixtures from the store export (real product, helper, wood-name Type, trailing-space variant, maya-chair-1 not in CH)
```

- **Reads (per block, minimum fields):** product (title, type, tags, category, SEO, description, options, metafields asked for); variants paged at
  125 up to 250 ("First 250 variants checked."); media paged at 50 up to 4 pages; duplicate titles by one `products(query: title:...)`; handle-list
  fields by `nodes(ids)` + `products(query: handle:a OR handle:b)`; market catalogues by one shared query. A part that is refused (scope or limit)
  is marked failed: its checks show "could not be read" in grey and the rest of the block still renders. Nothing is ever an empty or broken block.
- **Variant details** (SKU, image, weight, cost) are asked together; if Shopify refuses them the product is read again without and the SKU /
  weight / cost / variant-image checks are left out with a grey line.

## Profiles

A product is a **Real product**, an **Option product** (a finish, edge, leg or service the theme uses as a choice; about 13 of 150 in the export)
or a **Bundle**. The guess comes from Type, category, tags and title patterns (Settings, "Helper products"; editable). The block shows the guess
and the reason as a small bar with "Judge as" buttons. The buttons change the view only (no write, nothing stored). A check that does not apply to
the profile is not shown at all (it is counted as "not applicable" in a footnote).

## Rules (`RULE_CATALOGUE`; all also switchable one by one in Settings, Advanced)

| Group | Check | Level | Notes |
|---|---|---|---|
| Basics | Description not empty | Hurts | real, bundle |
| | Type set / not a wood name / one of the expected categories | Hurts / Hurts / Nice | wood names are a setting; the category list is empty by default (= not applicable) and "Detect" fills it from the Types in use |
| | Title not used by another product | Hurts | lists the handles ("Same title as N other products") |
| SEO | Title set / not longer than 60; description set / 50 to 160 characters | Hurts / Nice | thresholds are settings |
| Images | Enough images (default 1); alt text coverage ("x of y images have alt text", target 100%, first 5 missing listed) | Hurts | |
| Variants and pricing | Price above zero | **Blocks** | |
| | Compare-at below the price | Hurts | compare-at equal to the price is Nice (it is not a discount); Sale and badge uses the same function |
| | SKU, weight, cost per item, variant image (only when others have one), trailing / double spaces in variant titles, option value listed twice after trimming | Nice (spaces, duplicates: Hurts) | |
| Theme fields | The list on the Theme fields tab (default: tag_line, product_wood_type clean, material-main-title, wood type matches material title, hd_related_products / hd_recommended_products must exist and be published and not itself, stock_delivery, design_customisation, required_options targets exist, seo.hidden only true/false/0/1) plus length / seater / lead time and your own "metafield X must not be empty" checks | per field | |
| Markets | In at least one market | **Blocks** | |
| | Published in every market | Nice, or **Hurts** when the product is in the main market and missing in another | main market = Thresholds tab; the "active language" part of the rule is approximated (see Not verified) |
| Linked records | Swatches: DRAFT, empty group / group_key, test-looking names ("Group 1", "Test 3", "1"); delivery time: an ACTIVE record found for the product's wood / material / type; design records with an empty link | Hurts / Hurts / Nice | needs the metaobject scopes |

**Score** = weight of the checks that pass divided by the weight of all checks that apply (weights default Blocks 3, Hurts 2, Nice 1;
settable). Checks that could not be read or do not apply are left out. **Verdict:** "Ready", "Ready, N nice to have" or "N to fix before launch"
(Blocks + Hurts count as "to fix").

## The blocks

- **Product health** (`insights-product-health`): score, verdict, count strip, pending list by level, every row with the exact field name and an
  admin link (product page anchor, variant, metafield, SEO, the metaobject entry). Top 5 per list, "Show all N". Reads: product, variants, media,
  titles, handle lists, market catalogues, linked records.
- **Data quality checklist** (`insights-data-quality`): the same engine, grouped into seven tables. Each check pass / fail / not applicable and a reason.
- **Storefront readiness** (`insights-storefront-readiness`): one row per market in the Market availability list (same reader). Dot: green = all
  good; amber = something is missing but it can sell; red = not published or price missing / zero. Pieces: published, price present and not 0 in
  that market, translated title / description / SEO (language of the market from the Markets tab), language adaptation (from the Market adaptations
  tab; `translations(locale, marketId)`), delivery time found, preview link. No other text.
- **Options and swatches** (`insights-options-swatches`): each option value with its swatch record, group, group key, priority and 3D model. Flags:
  listed twice, extra space, DRAFT swatch, test-looking name, no group, no group key, no swatch (only when other values in the option have one).
  Markets where every variant is hidden by the hide-from-markets metafield. Variants without weight / SKU in one table (top 10, "Show all").
- **Content snapshot** (`insights-content-snapshot`): numbers, no pass or fail; a number turns amber when out of range. The dimensions row is shown
  only when a theme field with "dimension" in its key or name exists.
- **Market availability**: now on the shared market reader, so it cannot disagree with Storefront readiness.
- **Sale and badge**: says "On sale · N-M% off" (1005 of 1064 variants in the export are on sale, so this is normal) and only warns about odd
  cases: compare-at equal to or below the price on a variant. The warning "On sale, but the badge is empty" was removed: an empty badge shows as
  "No badge set (optional)".

## Bundle sizes (limit 64 KB each, measured by `npm run check:extensions`)

collections-tags 32.7, content-snapshot 40.3, **data-quality 62.8**, market-availability 37.1, options-swatches 43.8, **product-health 62.8**,
quick-links 32.4, recent-activity 32.4, sale-badge 48.6, storefront-readiness 47.8, translation-status 35.8 KB. The two health blocks are close to
the limit because they carry the whole engine. Do not add code to `rules.ts`, `facts.ts` or `healthSettings.ts` without checking.

## Settings (version 2) and "Detect from this store"

Same storage as before (one `$app` / `block_settings` JSON on the app installation, 100,000 character limit, recheck + read-back save). Version
bumped to **2**; `migrateSettings` fills every new section from the defaults, keeps everything saved, and carries a built-in check that was
switched off in version 1 into the new list of switched-off single checks. See `docs/BLOCK-SETTINGS.md` for the tabs.

## Test on ONE product first

1. `npm run deploy`, approve the two new scopes in the store.
2. Open the Settings page: "Detect from this store", read the proposals, add what fits, Review changes, password, Save.
3. Open `maya-chair-1`: Product health should list "Not published in CH" and Storefront readiness should show CH red. Market availability must say the same.
4. Open a finish (an Option product): the bar says "Option product" and no SEO / image / theme rows appear.
5. Open a product whose Type is `oak` or `Walnut`: the Type check fails with the reason.
6. Open a product with a variant title ending in a space: "Extra spaces in ..." on Variants and pricing.
7. Open a product with options: Options and swatches lists every value; compare a swatch with its entry in Content > Metaobjects.

## Not verified (cannot be checked from the cloud; nothing has run against the real store)

- `custom.hide_from_markets` and `custom.swatches_test`: the export does not show variant metafields. The names come from the brief. The format of
  `hide_from_markets` (market keys? handles? names?) is read defensively: any of the market key, handle or name as a separated list matches.
- Variant metafields in general: `variants(first) { nodes { metafield(namespace, key) } }` aliasing is untested on the real store.
- The `$app` / `block_settings` read from inside a block (the blocks fall back to the defaults and show a grey line if it is refused).
- Metaobject reads: `nodes(ids)` on `Metaobject` (fields `key value`, `capabilities.publishable.status`) and `metaobjects(type:, first: 100)`. The field
  names `group`, `group_key`, `group_priority`, `link` and the 3D model field are from the metaobjects export. The delivery-time match (a record
  matches when its name, handle or any field equals the product's wood, material or Type) is a guess; confirm with your real delivery records.
- Admin link anchors (`#variants`, `#seo`, `#media`, `#metafields`) and the metaobject entry address `content/metaobjects/entries/{type}/{id}`: only
  the product address is certain.
- `ProductVariant.sku`, `media`, `inventoryItem { unitCost, measurement.weight }` in API 2026-10 (the block retries without them if refused).
- `translations(locale, marketId)` for language adaptations (Storefront readiness).
- "Active language in the market" for the spread rule is approximated by the language of the market on the Markets tab.
- The primary market is the market key chosen on the Thresholds tab (default UK), not read from Shopify.
- Polaris components in the new blocks and tabs were only checked with stubs.
