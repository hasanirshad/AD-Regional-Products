# Regional Products — project memory

Read this first in every session. It is the standing context for this repo. Keep it short and true:
when a decision, rule or fact here changes, change this file in the same piece of work.
Last reviewed: 2026-10-25 (v0.1.0 + safety/accuracy work after commit 4237025; see "Open work").

## What this is

**AD Regional Products** (repo name `regional-availability`, docs call it "Regional Products").
An invite-only embedded Shopify app, built by APPSDAPPS (Hasan, Lahore) for **Hardman Design**: one
Shopify Advanced store, six markets (UK, US, DE, FR, NL, CH). It helps check and change **where
products can be bought**:

- **Visibility** = market catalogues (a product is "published" in a market when it is in the market's
  catalogue publication).
- **Checkout** = shipping profiles (a product only ships to the countries in its profile's zones).
- **Shipping profiles are the groups.** The app has no groups of its own, no saved data, no database.

The app reads live from Shopify every time. Shopify is the source of truth.

## Rules from Hasan (do not break)

1. **No server, no database, nothing saved by the app.** No auto-sync, no background writes. Manual actions only.
2. **Reads are free. Every write asks for the password.** `lib/guard.ts` (SHA-256 of the password in the
   code; it is a guard against accidents, not security). Two layers: screens call `useGuard().ask(action)`;
   `adminGraphql` refuses any `mutation` unless it runs inside `runUnlocked()`. A new write must never
   bypass this. Any write/update/change/create = password.
3. **Steps and previews before any write**: choose, review (nothing written), apply after a ticked
   confirmation and the password. No "Sync" page (it was removed on purpose).
4. **The market named `Global` with handle `de` does not exist** for the app (`lib/hidden.ts`): not listed,
   not counted, its catalogue ignored. Match is name AND handle.
5. **First load reads active products only** (quick); a banner button loads drafts and archived too.
6. **The app never creates shipping profiles, zones or rates.** The only shipping-profile edits it makes:
   moving variants into a profile, and (Fix 2) adding countries to an existing zone.
7. **Never push to `master` without Hasan's go-ahead.** He pushes himself; Cloudflare Pages builds from `master`.
8. Playbook (`shopify-app-playbook/APPSDAPPS-Shopify-App-Playbook.md` in the Hardman project, v2) is for
   setup and UI patterns only. Do not copy features this app does not need.

## How to hand work to Hasan

- He uses **Windows Command Prompt**. Any command he must run goes in **one `cmd` block**, with the
  folder named: `C:\Users\RBTG\Desktop\AppsDapps\products regional availability`.
- Use `git add -A` (not `git add .`). Typical block:
  `npm run typecheck && npm test && git add -A && git commit -m "..." && git push origin master`
  (only when he has agreed to a push).
- Files he must delete: give `del "path"` commands. Stale files break `tsc` (a deleted `sync.tsx` came
  stale `sync.tsx` stayed in his folder and broke `tsc`). He once ran Edit Metafields commands in this
  folder by mistake; `git reset HEAD~1` plus deleting the stray toml fixed it.
- He replies with screenshots. Keep changes small, say what he should see, say what you could not verify.
- The **device shell does not work** ("Workspace unavailable": Windows virtualization is off in BIOS; he
  said "leave it for now"). Claude cannot run git/npm on his machine. Work is done in the cloud copy
  (`/home/claude/regional-availability`), staged to `/mnt/user-data/outputs/regional-availability/`, and
  delivered with `device_commit_files`. Deleting files is done by him.
- Before editing, check the cloud copy still matches his folder (`device_list_dir`, compare sizes).

## Where it runs

| Thing | Value |
|---|---|
| Shopify app | `AD Regional Products`, client id `aaebd262b3b8b876abf919bcc9d31e36` (one app, no dev app) |
| Config | `shopify.app.production.toml` only. **Do not recreate `shopify.app.toml` or a dev toml.** |
| App URL | `https://ad-regional-products.pages.dev` (Cloudflare Pages project `ad-regional-products`) |
| Repo | GitHub `hasanirshad/AD-Regional-Products`, branch `master` |
| Cloudflare build | `npm run build`, output `build/client`, env `SHOPIFY_API_KEY` (client id), `NODE_VERSION=22` |
| Distribution | Custom distribution, one link = one store. Another store needs another app (`npx shopify app config link`) |
| Scopes | `read_inventory, read_locations, read_markets, read_products, read_publications, read_shipping, read_themes, read_translations, write_inventory, write_products, write_publications, write_shipping` (**`read_themes`, `read_inventory`, `write_inventory`, `write_products` added 2026-10-26 and `read_translations` added 2026-10-27: need `npm run deploy` and approval in the store**; until then the Storefront links page asks for a theme id by hand) |
| Admin API | `2026-07` via direct API access (`shopify:admin/api/graphql.json`), online mode |
| Release config | `npm run deploy` (= `shopify app deploy --config production`); needed after scope/toml changes |

There is no tunnel and no dev server that talks to Shopify: **direct API access only works inside the
admin**. Testing = push, Cloudflare builds, reload the app in the store admin. `npm run dev` is only
`react-router dev` for layout work.

## Stack

React Router 7 SPA (`ssr:false`), React 18, TypeScript strict (`noUncheckedIndexedAccess`), Polaris web
components (`s-page`, `s-section`, `s-table`, `s-banner`, `s-badge`, `s-clickable`, ...; types from
`@shopify/polaris-types`), vitest. No server code, no extra CSS framework. Node 22.

## Map of the code

```
app/
  root.tsx, routes.ts            head scripts (App Bridge FIRST), layout + index(overview) + products
  views/
    layout.tsx                   nav (Overview, Products) + Gate + shared state
    state.ts                     AppData {shop, markets, hiddenCatalogIds, profiles}; loaded once; refresh()
    products-state.ts            products load (scope active|all), membership, filters/selection state
    overview.tsx                 home: tabs Overview / Products / Review fix; issues, tiles, tables
    products.tsx                 filter + select + "Move N selected to" a profile -> MoveReview
    channels.tsx                 Channels & catalogues: filter + select products, enable/disable sales channels, add/remove catalogues (INCLUDES the Global market)
    links.tsx                    Storefront links (READ ONLY): per product, a link in each market's primary domain; theme picker (live / preview id); US gets stay_us=1; CSV export
    check.tsx                    Product check: one product, markets / countries / catalogues / profiles / variants
  components/
    RunFlow.tsx                  THE apply flow, generic over a RunEngine (confirm, password, recheck, first-product trial, read-back, CSV). Move, Unpublish fix and Channels use it
    PublishReview.tsx            review of a channel/catalogue change (inside RunFlow)
    MoveReview.tsx               move review (inside RunFlow)
    FixReview.tsx                fixes: UnpublishFix (RunFlow) | CountriesFix (own recheck + read-back) | UnifyFix (-> MoveReview)
    PasswordGate.tsx             useGuard(): dialog + runUnlocked
    FilterBar, SelectField, ScopeBanner, Gate, Loading, PageBody
  lib/
    admin.ts                     GraphQL client: 30 s timeout, retry 429/THROTTLED, cost pause, write lock
    guard.ts                     password hash, runUnlocked, isMutation, assertUnlocked
    shopify-data.ts              ALL reads (shop, markets, profiles, products page, membership)
    parse.ts / types.ts          raw API -> plain shapes
    overview.ts                  core logic: cell states, coverage, issues, focus, countryMatrix (pure)
    keys.ts                      GENERAL, NO_PROFILE keys (kept out of overview.ts to avoid import cycles)
    parts.ts                     buildParts: product -> variants per profile (split detection)
    move.ts / applyMove.ts       planMove (pure, takes parts) / applyMove (writes: variants then catalogues; 3 products per read)
    readback.ts                  readState + pure findDrift (before Apply) / findMismatch (after Apply)
    runPlan.ts                   recheckPlan, runPlan (apply + read back + report rows), subPlan, moveEngine
    engine.ts                    RunEngine type: what RunFlow needs from a kind of change (lines, recheck, run, describe)
    channels.ts                  buildTargets (channels + all catalogues incl. hidden markets), planPublish (pure)
    publish.ts                   applyLines / runPublish / recheckPublish / publishEngine (publishablePublish / Unpublish, then read back)
    report.ts                    reportCsv / downloadCsv (no storage)
    check.ts                     buildProductCheck (pure)
    links.ts                     pickRoot (market domain), productUrl (preview_theme_id, stay_us), adminUrl, buildLinks, linksCsv (pure)
    fix.ts                       fix 1 plan, fix 2 (zones with rates only) + zoneDrift / zoneMissing / runCountryFix, fix 3 = a move
    filter.ts, dom.ts, countries.ts, hidden.ts
scripts/preload.mjs              modulepreload hints (ROUTE_IDS = views/layout, views/overview)
scripts/check-extensions.mjs     builds each Product Insights block (esbuild), 64 KB limit, unique handle/uid/name
extensions/                      Product Insights: 7 read-only admin blocks (Preact, own tsconfig). See "Product Insights blocks" below
public/_headers                  frame-ancestors for Shopify + immutable cache for /assets/*
```
278 tests in 26 files (`app/lib/*.test.ts` and `extensions/**/*.test.*`): pure logic, admin client, guard, dom helpers, and `runPlan.test.ts`,
which runs the real `applyMove` / `runPlan` against a fake Shopify (incl. a silent no-op). `testkit.ts` has the builders.
No UI tests; no test for `shopify-data` queries (they only run inside the admin).

## Domain model (read before touching `lib/overview.ts`)

- **Shipper** = a shipping profile, or `GENERAL` (the default profile: products in no other profile).
- **Parts** = product id -> `{key, variants}[]`: where a product's VARIANTS are (Shopify assigns profiles per
  variant). Read from `deliveryProfile.profileItems` (with `variants`) plus the product's variant count; the rest is
  General. **Membership** = product id -> the profile holding most variants (used by filters and labels).
  A product in more than one place is **split**: it is counted by its weakest profile (a country can buy it only where
  EVERY part ships, `coverageParts`), kept out of the per-profile counts, and has its own issue and fix.
- **Zone rates**: a country ships only through a zone with an active rate (`ProfileZone.rateCount`; 0 = none, null =
  unknown, treated as rated). `ProfileSummary.countries` already excludes unrated zones; they are in `unratedCountries`.
- **Coverage(profile, market)** = `all | mixed | none`: which of the market's countries the profile ships to
  (explicit zone countries, or any country when a zone is "rest of world").
- **CellState** per product per market: `sellable` (published, all countries ship), `partial` (published,
  some countries blocked), `blocked` (published, no country ships), `unpublished` (not in the catalogue).
- Only **active** products count in the grids. Draft/archived get shipping moves only, never catalogue changes.
- **Issues** (Needs attention): products in no catalogue; profile with variants but no rates; truncated
  zones; a zone with countries but no rates (critical); no General profile; **blocked** (critical, `fix`); **partial**
  (warning, countries fix); **split products** (warning, "unify" fix); market with no catalogue; notes from the products
  load (caps hit, rates unreadable).
- **Move** (`planMove`): modes `full` (publish where it ships, unpublish where none), `unpublish`, `none`.
  It publishes into **every** catalogue of a market. A product already in the target profile still gets
  visibility changes. `applyMove`: phase 1 variants (5 products per `nodes` read, reject >250 variants, 100
  variants per `deliveryProfileUpdate`), phase 2 per product `publishablePublish`/`publishableUnpublish`
  with `publicationId`. A product whose shipping move fails is skipped for catalogues. `PRODUCTS_PER_READ` is **3**
  (3 x 250 variants = 750 requested cost; 5 was over Shopify's 1,000 limit).
- **Safe write flow** (`RunFlow`): confirm box -> password -> `recheckPlan` (reads again, stops if anything differs) ->
  optional first-product trial -> `runPlan` (apply, then `readState` + `findMismatch`, one retry) -> result
  `done` / `not verified` / `failed` / `not applied` per product -> CSV. "Not verified" = Shopify said ok but still shows the old state.
- **Fix 1** = unpublish the affected products from that market's catalogues only (mode `unpublish`, filtered to
  the market). **Fix 2** = add the market's missing countries to one zone of the profile: sends the zone's
  existing countries plus the new ones with `includeAllProvinces` (the `countries` list is assumed to replace;
  Shopify's docs do not say). Only zones WITH rates are offered; countries sitting in a zone without rates are listed
  ("add a rate in Shopify") and not moved. `runCountryFix` rechecks the zone, writes, reads the zone back. **Fix 3 (unify)**
  = choose one profile and review a normal move of the split products.

## Shopify calls and their status

Reads **work on the Hardman store** (the Overview shows real data: markets, the DE-DHL profile, products).
**No write has been run on a real store yet.** Treat every write as unverified until a canary passes.

| Call | Where | Status |
|---|---|---|
| `shop`, `markets(first:100)` (catalogs first:10, regions first:250), `deliveryProfiles`, `products(first:25, query)` with `resourcePublicationsV2(first:10, onlyPublished:true, catalogType:MARKET)`, `deliveryProfile.profileItems` | `shopify-data.ts` | read OK |
| `nodes(ids)` -> `Product.variants(first:250)` | `applyMove.ts`, `readback.ts` | reads: unverified on the real store (cost fixed to 3 per read) |
| `deliveryProfile.profileItems { variants }`, `locationGroupZones.methodDefinitions { active }`, `product(id)` detail | `shopify-data.ts` | new reads, not yet seen on the real store; variants/rates reads fall back safely and the Overview says so |
| `deliveryProfileUpdate(id, {variantsToAssociate})` | `applyMove.ts` | unverified (docs do not describe it) |
| `publishablePublish` / `publishableUnpublish(id, input:[{publicationId}])` | `applyMove.ts` | publish confirmed by Shopify community answer for market publications; unpublish unverified |
| `deliveryProfileUpdate(id, {locationGroupsToUpdate:[{id, zonesToUpdate:[{id, countries}]}]})` | `fix.ts` | unverified; replace-vs-add semantics undocumented; community reports of `deliveryProfileUpdate` silently ignoring some fields |

**Caps** (the Overview now shows a note when the first two are hit): products 10,000 (400 pages x 25), membership 4,000 pages
per profile, regions 250 per market, catalogues 10 per market, publications 10 per product, markets 100, rates 10 per zone,
variants 250 per product.
Zones (30 per location group) are flagged (`zonesTruncated`).

## Gotchas learned here

- React 18 forwards only `click` and `input` from custom elements. Use `lib/dom.ts` ref helpers
  (`onValue`, `onChecked`, `onInput`, `onValues`, `onRemove`). Booleans on custom elements: `x || undefined`.
- `s-password-field` typing: use a callback ref + state element + native `input` listener (a direct ref hits
  "union type too complex").
- App Bridge must be the first script in `<head>`. Direct API access never answers outside the admin.
- Config file names: only `shopify.app.<name>.toml`. A leftover toml pointing at a deleted app breaks the CLI.
- `npx shopify app config link` in the wrong folder creates a new app and a toml there (happened once).
- `rsync` is not installed in the cloud box; copy with `tar | tar` or `cp`.
- Cloud copy is not the source of truth for deletions: Hasan deletes files on his side.

## Commands

`npm test` (vitest), `npm run typecheck`, `npm run build`, `npm run deploy`. Before any handoff run
test + typecheck + build. Expected: 278 tests pass, typecheck clean (`typecheck` now also checks `extensions/`). `npm run check:extensions` builds the seven blocks and checks Shopify's 64 KB limit.

## Channels & catalogues page (added 2026-10-26)

- Route `/channels`. Own selection/filters (`channelsUi` in the layout). Rows get the hidden Global catalogue back
  (`products.hiddenCatalogs`), and `AppData.hiddenMarkets` supplies Global's catalogue as a target. **This is the only page
  where the hidden market appears** (Hasan asked for it). Everywhere else it stays hidden.
- Targets = sales channels (`publications` with no catalogue; read by `loadChannels`, name = app title) + every
  catalogue that has a publication id. Publishing is the same call for both: `publishablePublish/Unpublish(id, [{publicationId}])`.
- Flow: choose products (max 1,000) -> choose per channel/catalogue "No change / Enable|Add / Disable|Remove" -> review
  (reads the selected products FRESH with `readPublications`; active products only; warnings for Online Store removal and
  for markets where the product cannot check out) -> `RunFlow` (password, recheck, first-product trial, read-back, CSV).
- Unverified on the real store: `publications` query shape (`name` field falls back to app title), `publishableUnpublish`
  with market publications, `resourcePublicationsV2` without `catalogType`.

## Inventory page (added 2026-10-26)

- Route `/inventory` (nav "Inventory"), own selection/filters (`inventoryUi`). WRITES: password, review, recheck, first-product trial, read-back, CSV
  (the shared `RunFlow`, `InventoryReview`, `lib/inventory.ts`, `stockEngine`).
- Settings (each switch on/off): **Track quantity** (`inventoryItem.tracked = true`), **Sold out = not available** (`inventoryPolicy = DENY`),
  **Set the quantity** (default 1, at one or MORE ticked locations (checkboxes, none ticked by default unless the store has one), applied to EVERY variant of each selected product; replaces higher stock too, warned; unticked locations are never touched).
- Product list (Step 1) shows, per product, read only: **Tracked** (all / none / n of N), **When sold out** (Stops at 0 / Keeps selling / n of N),
  and **Stock by location** (every location where a variant is stocked, available total, "(n of N variants)" when partial). Read for the products on
  the current page only (2 per call, first 40 variants, 8 locations: `readStockOverview`, `summarizeStock`), cached until "Refresh stock" or after a write.
- **Filter panel** (`components/InventoryFilters.tsx`, logic in `lib/inventoryFilter.ts`, state `invFilters` in the layout): search box + "Filters (n)" button that
  opens a panel above the table + one removable chip per value. Different boxes must ALL match (AND). Several values in one box: any of them by default; for Tag, Catalogue and
  Stocked-at a "A product needs: any / all of the chosen" dropdown appears (vendor, type and status are always "any"). **Tag is a plain dropdown** (pick one, it
  is added to the chosen tags; Hasan asked for it). Type-and-pick lists (with counts, "Browse all"): Vendor, Product type, Catalogue, Stocked at (location). Tick boxes:
  Status, Availability, Tracked. Number of variants: at least / at most. Availability, Tracked and Stocked-at need the stock of each product: when one is on,
  the stock of ALL products matching the other filters is read in the background (2 per call, list fills as it goes, "Select all matching" waits).
  Products whose stock is not read yet are left out and counted (`applyStockFilters().waiting`). Other pages still use the old `FilterBar`.
- Also per row: the product title links to the product in Shopify admin, and an **Availability** column (Available / Sold out / n of N sold out;
  sold out = tracked, stops at 0, nothing available at any location: `StockSummary.soldOut`).
- **Speed** (quick filter changes froze the tab): `FilterBar` keeps typing in its own box and filters 250 ms after the last key (all pages);
  rows are a memoised `StockRow` with a stable toggle; 25 rows per page; the stock read for a page starts 400 ms after the filters rest
  and is cancelled if they change again.
- Calls: `productVariantsBulkUpdate` (tracked + policy, one per product, 250 variants max per call) then `inventorySetQuantities`
  (name `available`, reason `correction`, `changeFromQuantity: null` because API 2026-04+ has no `ignoreCompareQuantity`). Tracking goes first.
- **Only these locations** (switch): after tracking and quantities, every variant is taken OUT of all locations that are not ticked
  (`inventoryDeactivate(inventoryLevelId)`, one call per level). A variant not stocked at EVERY ticked location keeps its other locations
  (it must stay stocked somewhere; warned). The review warns how many removed locations still hold stock (that count is lost).
  Shopify may refuse to remove a location with open orders: that product shows as failed with Shopify's message.
- Variants not stocked at a ticked location get no quantity (warned; stock them in Shopify first). Products with more than 50 variants or more than 8 locations on a variant are left out.
- Read for the plan: `locations`, and per product `variants { inventoryPolicy inventoryItem { tracked inventoryLevels(first:8) { id location quantities } } }`
  (2 products x 25 variants per read; a bigger product is read alone with 50). `VariantStock.levels` = every location the variant is stocked at.
- Scopes needed: `read_inventory, write_inventory, write_products`. UNVERIFIED on the real store: `inventoryItem.tracked` inside
  `productVariantsBulkUpdate`, setting `available` on an item right after it was tracked, and `changeFromQuantity: null`. Run the first-product trial.

## Product check page (changed 2026-10-26)

- `/check` opens with the same filter bar as the other pages (search, status, vendor, type, tag, catalogue; own state `checkUi`) and a product
  list (15 per page, "Check" button per row). One product at a time. Choosing one shows its details (same sections as before) with a
  "Back to the list" button; filters and page are kept. The product is still read fresh from Shopify when chosen.

## Storefront links page (added 2026-10-26)

- Route `/links`, read only (no password). Own selection/filters (`linksUi`). Hidden Global market stays hidden here.
- Market address: `Market.webPresences { domain, subfolderSuffix, rootUrls }` (`defaultLocale` removed: it needs `read_locales`/`read_markets_home` and made the whole read fail; without it the root URL with the shortest path is taken as the default language; a lighter query without `rootUrls` is the fallback) (API 2026-07, checked in the docs, not yet seen
  on the real store). Own domain first, then subfolder, then the store's primary domain (`shop.primaryDomain`). Default-language root URL.
- **Typed base domains (2026-10-26):** each market row has a "Type the base domain" field + "Save domains". Stored in the browser's
  localStorage (`ad-regional-products:market-domains`, `lib/domains.ts`), NOT on a server (no-server rule). Per browser/device only; may come
  back empty in a private window. A typed address replaces the one from Shopify (source "Typed in by you"); clear the field and save to go back.
  `normalizeBase` adds https, strips trailing slash, allows a subfolder, rejects /products/…, query strings and non-domains. The page works
  even if the Shopify read fails.
- Theme: `themes` query needs `read_themes`; on failure the page says so and offers "Another theme: enter its id". Live theme = no parameter;
  any other theme = `?preview_theme_id=<numeric id>`. Unverified: that preview_theme_id works on every market domain.
- The market that contains the United States gets `stay_us=1` (Hasan: otherwise visitors outside the US are redirected).
- Export: CSV, one row per product and market: Product, Market, Store link, Admin link, Published in market. Admin link =
  `https://admin.shopify.com/store/<myshopify handle>/products/<id>`.

## Product Insights blocks (added 2026-10-27)

Seven separate **read-only** admin blocks on the product details page (target `admin.product-details.block.render`, API 2026-10,
Preact, `s-*` components), in `extensions/`: Market Availability, Translation Status, Sale and Badge, Data Quality Checklist,
Collections and Tags, Quick Links, Recent Activity. No server, no routes, no writes, no write scopes; they call the Admin API
with `shopify.query`. Full note (scopes, constants, API gaps, deploy, test plan): `docs/PRODUCT-INSIGHTS.md`.

- Store-specific values live only in `extensions/shared/constants.ts` (market domains, languages, sale badge and collection,
  required metafields, preview theme id). Several are guesses marked CONFIRM; lead-time keys are not known yet (check shows "Not configured").
- Shared code is in `extensions/shared/` (query wrapper with a read-only guard, pricing, collections, translations, UI states).
- New scope: `read_translations` (needs `npm run deploy`, then approval when someone opens the app). New devDependencies: `preact`, `@shopify/ui-extensions`, `preact-render-to-string`.
- Verified: typecheck, 47 new tests against a fake Shopify, `shopify app build` of all seven, a Chromium smoke run with a stub `shopify` global.
  NOT verified: any query against the real store.

## Open work

Done on 2026-10-25 (in code, not yet pushed/verified live): C1 variant-level profiles, C2 zone rates, C3 partial fix,
W1 recheck, W2 read-back, W3 first-product trial, W4 CSV report, Product check page, `applyMove` cost fix.

See the v2 plan: `docs/V2-PLAN.md` (also in the Hardman project as `regional-products/V2-PLAN.md`). First: run the canary write test
on one product (DE-DHL product, "Unpublish from France"), then the safety and diagnosis work in the plan.
Hasan still has to: confirm Cloudflare is green on the latest push, run `npm run deploy` if scopes change,
and install the app on the right store with the custom distribution link.
