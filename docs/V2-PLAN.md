# Regional Products v2: review and plan

> **Status 2026-10-25.** Done in code (not yet run against the real store): C1, C2, C3, W1, W2, W3, W4, the simple "Product check" page (a first cut of F2), and the `applyMove` read cost fix (5 to 3 products per read; 5 x 250 variants was over Shopify's 1,000 limit). Still open: everything else below, and the canary run in section 5, which has to happen on the real store before any other write is trusted.


Written 2026-10-25 from a full read of the repo at commit `4237025` (v0.1.0, 77 tests passing) and a
check of Shopify's docs. **No code was changed.** Sizes are rough build effort, excluding Hasan's test
time: **S** under half a day, **M** 1 to 2 days, **L** 3 to 5 days.

## 1. Verdict

**What is already strong.** One clear idea (visibility = catalogues, checkout = shipping profiles,
profiles are the groups). Pure logic separated from React and covered by tests. A write lock that cannot be
bypassed. Reads are live, nothing is stored, so there is nothing to get out of sync. Steps and previews
before every write.

**What holds it back.** Five things, in this order:

1. **No write has ever run on a real store.** Moving variants, unpublishing and the zone edit are all
   unverified, and Shopify's docs do not describe two of them well. Everything new should wait for a canary test.
2. **The app can show a wrong answer.** It treats shipping as one profile per product (Shopify does it per
   variant), counts a country as "ships" even if its zone has no rate, and ignores `partial` problems.
3. **Writes are not double-checked.** The review is built from data read earlier and never rechecked before
   Apply, and nothing is read back afterwards. Shopify's community has reports of `deliveryProfileUpdate`
   returning success while ignoring some fields (rate conditions).
4. **It cannot be tested without a live store.** Direct API access only works inside the admin, and the
   cloud box cannot load Shopify's scripts (checked: `cdn.shopify.com` returns 403), so UI and write code
   are tested by hand only. There is no CI either.
5. **The model is profile-first, but the question is market-first.** People ask "where should this product
   be sold?", not "which profile should it go in?". The app makes you work that out yourself.

**Direction.** Make writes trustworthy, make the answers correct, then make it answer questions
(a market-first "Set availability" flow and a "Can this be bought?" checker). Keep the rules: no server, no
database, nothing saved, password on every write.

## 2. Findings

### 2.1 It can show a wrong answer

| # | Finding | Where | Effect | Fix |
|---|---|---|---|---|
| C1 | **DONE.**  **Profiles are per variant in Shopify, per product in the app.** `loadMembership` maps product to profile and the later profile overwrites. | `shopify-data.ts` `loadMembership` | A product with variants in two profiles is shown under one. Blocked/sellable can be wrong. | Read the variants of each profile item and the product's variant count. Mark such products "Split across profiles", add an issue and a "move whole product" fix. (M) |
| C2 | **DONE.**  **Rates are checked per profile, not per zone.** `rateCount` is the profile's total of active rates, and any country in any zone counts as "ships". | `parse.ts`, `shipsTo` | A zone with countries but no active rate shows as shipping, so the product looks buyable and is not. | Read `methodDefinitions { active }` per zone. A country ships only if its zone has an active rate. New issue: "Zone X has countries but no rates". Show "has conditions" (weight/price) as information. (M) |
| C3 | **DONE.**  **`partial` has no warning and no fix.** Only `blocked` raises an issue. | `overview.ts` issue loop | A market where some countries cannot check out (for example Switzerland with Liechtenstein) is only visible in a table. | Add an issue per profile and market with the missing countries, and a fix "Add the missing countries" (reuses Fix 2). (S) |
| C4 | **Catalogues without their own publication are not understood.** Shopify says a catalogue without a publication uses the Online Store channel. The app sees "not published" and skips such catalogues. | `parse.ts`, `move.ts` (`missingPublication`) | Wrong counts and "cannot publish" for markets set up that way. | Detect it, mark the market "uses Online Store", read the Online Store publication for it, and say plainly that publish/unpublish is not available there. (M) |
| C5 | **The Online Store channel is not checked.** | no query | An active product not on the Online Store channel is invisible everywhere and the app cannot tell. | Read publication on the Online Store channel. Issue: "N active products are not on Online Store". (S) |
| C6 | **A publish goes into every catalogue of a market.** | `move.ts` loop over `market.catalogs` | If a market has two catalogues (for example main and outlet), a product is added to both. | When a market has more than one catalogue, Review shows a catalogue choice per market. (S) |
| C7 | **Silent limits.** Products 10,000, profile items 10,000 each, regions 250, catalogues 10 per market, publications 10 per product, markets 100. Only zones are flagged. | `products-state.ts`, `shopify-data.ts` | A bigger store gets quietly incomplete numbers. | Keep `hasNextPage` for every list. Show "Some data was not read" with the list, and paginate the small limits. (S) |
| C8 | **A failed refresh is not handled.** After a write the app calls `void refresh()` and nothing catches a rejection. | `overview.tsx`, `products.tsx`, `state.ts` | If the reload fails, the old numbers stay on screen with no message. | Catch it and show an error banner with "Try again". (S) |

### 2.2 Writes are not double-checked

| # | Finding | Fix |
|---|---|---|
| W1 | **DONE.**  The review uses data read earlier. Nothing is rechecked at Apply. | **Recheck before Apply**: read the affected products again (profile, publications). If anything differs, show what changed and re-plan. (M) |
| W2 | **DONE.**  Nothing is read back after a write. | **Verify after Apply**: re-read and compare. The result says "verified" or "Shopify accepted it but nothing changed". (M) |
| W3 | **DONE.**  A bad first write would hit every selected product. | **Canary**: apply to the first product, verify, then continue (or stop). (S) |
| W4 | **DONE.**  No record of what was changed. | **Change report** after every run: CSV with product, handle, before, after, status per row. No database needed. (S) |
| W5 | No undo. | **Undo file**: the before-state is downloaded with the report. "Undo from file" plans the reverse and uses the same review and password. (M) |
| W6 | Big runs need more than a tick. | At 50 products or more, also type the count (for example `UNPUBLISH 120`). Say in the password dialog what is about to happen. After 3 wrong passwords, wait 30 seconds. (S) |

### 2.3 Engineering and testing

| # | Finding | Fix |
|---|---|---|
| E1 | No CI. Pushing to `master` is the release, so a broken push breaks the client at once. | GitHub Actions: typecheck, test, build on every push and pull request. Dependabot. (S) |
| E2 | `applyMove`, `applyCountryFix` and `shopify-data` have no tests. | Make the client's transport swappable and write a **FakeShopify** (the 10 calls the app uses) with failure modes: userErrors, throttling, silent no-op, partial failure, over 250 variants. (M) |
| E3 | No UI tests. | Demo mode (`?demo=1`, fake transport and sample data) plus Playwright. **Run it in GitHub Actions** (full network). The cloud box cannot load Polaris. (M) |
| E4 | `overview.tsx` is 659 lines. `MoveReview` and `FixReview` repeat the same apply/result/progress code. | Split the overview into section components. Extract a shared `ReviewShell`, `RunView` and `ApplyBar`. (M) |
| E5 | Leftovers: tunnel and HMR code in `vite.config.ts`, `Gate` heading says "Regional Availability", two table columns both called "Profile", two tiles open the same list ("In a profile", "Shipping profiles"). | One cleanup pass. (S) |
| E6 | Few security headers. | Add `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` to `public/_headers`. (S) |
| E7 | No way to see which build is running. | Show version and commit (`CF_PAGES_COMMIT_SHA`) in the footer, plus a "Copy diagnostics" button that includes Shopify's `x-request-id`. (S) |
| E8 | Reads are sequential and everything reloads after a write. | Read profiles in parallel. After a write, re-read only the changed products. Add timing logs to see if the store needs bulk operations. (M) |

### 2.4 UX

- **Two product lists that do different things.** The Overview "Products" tab has market columns but no
  selection. The Products page has selection but no market columns. Merge them: one table with market
  columns, selection, bulk actions and a per-row fix. (M)
- **Plain-language help.** Hasan had to ask what "Partial" and the tiles mean. Add a small legend and "?"
  popovers: Sells / Partial / Blocked / Not published, and what each tile counts. (S)
- **Needs attention gets long.** Group by profile, collapse, show counts. (S)
- **"Last read at" and a Refresh button** on every page. Remember the scope choice (localStorage, per viewer). (S)
- **Check phone width and keyboard use** of the clickable tiles and tables. (S)

## 3. Strong features to add, ranked

| # | Feature | What it does | Needs | Size | Risk |
|---|---|---|---|---|---|
| F1 | **Set availability (market-first)** | Pick products, tick the markets where they should be sold. The app plans the catalogue publishes/unpublishes and suggests the shipping profile that ships exactly there (or the smallest one that covers it). If no profile fits it says which zone or profile to create in Shopify. Always shows the choice and the full review. | Pure `planAvailability()` reusing `planMove`; no new scope | L | Medium: profile choice must be explicit |
| F2 | **"Can this be bought?" checker** | Choose a product and a country. Shows the chain: status, published in the market?, country in the market?, profile ships there?, zone has a rate?, Online Store? and a verdict with the fix. Reverse view: pick a country and list the products that cannot be bought there. Read only. | Data from C2 and C5 for the full chain; v1 works with today's data | M | Low |
| F3 | **Safe-writes kit** | W1 to W6 above. | none | M to L | Low, high value |
| F4 | **Fix queue** | Tick several warnings (including partial) and run them under one review, one password. Order: shipping, then countries, then catalogues. Adds a third fix to blocked warnings: **move to a profile that already ships there**. | F3 | M | Low |
| F5 | **One product table + deep links** | Section 2.4 merge, with filters and tab in the URL (`?profile=…&market=…&state=blocked`) so a link can be sent to Liam: "these 12 products". | none | M | Low |
| F6 | **Exports and a client report** | CSV of problems, products by market, checkout by country. A standalone read-only HTML report for the client. | none | S to M | Low |
| F7 | **Snapshot compare** | Download a snapshot (JSON). Load an older one to see what changed since: "12 products newly blocked". Replaces history without a database. | F6 | M | Low |
| F8 | **Zone helper** | Create a zone for a market by cloning the rates of an existing zone, instead of sharing its rates (Fix 2 shares them). | Canary proves zone edits first | L | High: rate shapes are complex |
| F9 | **Instance config** | One file (`app.config.ts`): app name, hidden markets, password hash. A new client store is one file and a new app link. | none | S | Low |
| F10 | **Stock-location check** | Flag variants not stocked at the locations of the profile's location group (cannot be fulfilled). | `read_inventory` (approval prompt) | L | Medium: heavy reads |
| F11 | **Bulk operations** | Read all products and run large publishes through Shopify's bulk operations. Only if timing logs (E8) show the store needs it. | none | M | Medium |
| F12 | **Storefront signals** (deferred by Hasan earlier) | Write a product metafield with the countries where it can be bought, so the theme can show "not available in your country" or hide the buy button. Separate project with the theme chat. | `write_products` | L | Medium |

Not building: auto-sync, a database, creating shipping profiles from scratch, price changes.

## 4. Roadmap

Each phase is one push (Hasan's go-ahead), ends with a store test, and updates `CLAUDE.md`.

| Phase | Version | Content | Done when |
|---|---|---|---|
| **0 Prove and protect** | 0.1.x | Canary write test on the real store (section 5). CI (E1). Cleanup (E5), small bugs (C8). Transport swap, FakeShopify and fixtures recorded from the canary (E2). Security headers (E6), version footer (E7). | Every write call is marked verified or fixed. CI is green. `applyMove` and the zone edit have contract tests. |
| **1 Safe writes** | 0.2 | F3 in full: recheck, read-back, canary mode, change report, undo file, typed confirm, password cooldown. Limit warnings (C7). | A run that Shopify silently ignores is reported as failed. A report and an undo file download after every run. |
| **2 Correct answers** | 0.3 | C1 split products, C2 zone rates, C3 partial fix, C4/C5 catalogue and Online Store checks, C6 catalogue choice. F2 checker v1. Help layer. | Overview numbers match the Shopify admin on the Hardman store for 5 spot-checked products. |
| **3 Workflow** | 0.4 | F1 Set availability. F4 fix queue. F5 one table and deep links. E3 demo mode and E2E in CI. E4 refactor. | A product can go from "sold in the wrong places" to correct in one review. |
| **4 Reach** | 0.5 to 1.0 | F6 and F7 reports and snapshots. F9 instance config. E8 performance (and F11 if needed). Then F8, F10, F12 as separate decisions. | Hardman uses it for a month without a bad write. Then call it 1.0. |

Rough total before 1.0: Phase 0 about 3 days, Phase 1 about 5, Phase 2 about 6, Phase 3 about 8, Phase 4 about 6.

Scopes: none of Phases 0 to 3 needs a new scope. F10 needs `read_inventory`, F12 needs `write_products`.
Any scope change means `npm run deploy` and an approval prompt on the store.

## 5. Test strategy

- **Unit** (exists): keep logic pure. Every new rule gets a test before the UI.
- **Contract** (new): FakeShopify implements the calls the app uses with the real response shapes. Failure modes
  are scripted, including "Shopify says success and changes nothing".
- **Fixtures**: save sanitized real responses from the canary and use them as golden files.
- **UI**: demo mode and Playwright run in GitHub Actions. The cloud box can still run vitest with a simple stub
  for the `s-*` elements.
- **Real store**: the canary below, then a short checklist per phase (`docs/store-test-checklist.md`).

### Canary protocol (Phase 0, do this before anything else is built)

Do it on the Hardman store with one product. Take a screenshot at each step.

1. **Unpublish.** Overview, warning "…published in France…", **Unpublish from France**. Review must show 1 product and
   "− France". Apply with the password. Expect "Done, 1 catalogue unpublish".
2. **Check.** In Shopify, the product's market/catalogue availability no longer includes France; UK and US are
   unchanged. Reload the app: the France warning is gone, the UK and US warnings remain.
3. **Restore by hand** in Shopify (no undo exists yet), so the store is back as it was.
4. **Variant move.** Pick a test product (one published only where DE-DHL ships, so no new warning appears), Products, **Move** to DE-DHL with catalogues set to "do not change".
   Check the DE-DHL profile in Shopify now lists its variants. Move it back to General.
5. **Zone edit (Fix 2): never first on a real zone.** Create a throwaway profile with no products and one zone
   with one country. Add a second country with Fix 2. Check in Shopify whether the zone now has both countries
   (replace or add), the rates, and that nothing else changed. Delete the throwaway profile.
6. Write the results into `CLAUDE.md` (the status table) and keep the responses as fixtures.

## 6. Small architecture changes

- `lib/transport.ts`: `adminGraphql` gets its transport from one place (direct API by default, fake in demo
  and tests). The write lock stays in `adminGraphql`, so every transport is guarded.
- `lib/plan/`: planners (`planMove`, `planUnpublishFix`, `planCountryFix`, later `planAvailability`) all
  return the same `Plan` shape (lines, totals, blockers, warnings, reverse). The review and run views then
  work for every plan, and the undo file is just `plan.reverse`.
- `views/overview/*`: one file per section.
- `app.config.ts` (F9): instance settings in one place.

## 7. Risks and defaults I chose

| Risk | Handling |
|---|---|
| Shopify behaviour is unknown for variant moves, unpublish and zone edits. | Canary first, read-back always, `userErrors` shown as they are. |
| `master` is production, there is no staging. | Keep one app as Hasan decided. CI must be green before he pushes. Revisit a staging app only if a bad push happens. |
| I cannot run git, npm or the app on his machine (device shell off, `cdn.shopify.com` blocked here). | CI becomes the feedback loop. Connecting GitHub to claude.ai would let me read CI results. Enabling virtualization in BIOS would fix the shell. |
| The password is in the page code. | Stated and accepted: a guard against accidents. Extra friction (typed count, cooldown) is for big runs only. |
| Admin API version changes. | Pinned at `2026-07`. Check the changelog every quarter before bumping, run the canary again after a bump. |
| One app is tied to one store. | F9 makes a new client a one-file change plus a new app link. |

Defaults taken without asking: password stays on every write; nothing is saved (reports and undo are
downloads); phase order as above; the zone helper waits for the canary; storefront signals stay a separate project.

## 8. Sources checked

- [DeliveryLocationGroupZoneInput](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/DeliveryLocationGroupZoneInput): `countries` is "countries to link to the zone"; replace vs add is not stated.
- [DeliveryCountryInput](https://shopify.dev/docs/api/admin-graphql/unstable/input-objects/DeliveryCountryInput): `code`, `restOfWorld`, `includeAllProvinces`, `provinces`.
- [DeliveryProfileLocationGroupInput](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/deliveryprofilelocationgroupinput): `zonesToUpdate`, at most 5 zones per request advised.
- [deliveryProfileUpdate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/deliveryprofileupdate): needs a shipping scope; `variantsToAssociate` is not described.
- [publishableUnpublish](https://shopify.dev/docs/api/admin-graphql/latest/mutations/publishableUnpublish): `write_publications`; does not mention market catalogues.
- [Publish product to specific market](https://community.shopify.dev/t/publish-product-to-specific-market/6301): `publishablePublish` with the market publication id (`catalogType: MARKET`) works.
- [About catalogs for different markets](https://shopify.dev/docs/apps/build/markets/catalogs-different-markets): a catalogue without a publication uses the Online Store channel; a product must be in at least one applicable catalogue.
- [deliveryProfileUpdate silent failures](https://community.shopify.dev/t/deliveryprofileupdate-conditionstoupdate-and-conditionstodelete-silently-fail-with-no-errors/32260): conditions fields report success and change nothing (unanswered).

## 9. Built on 2026-10-25 (what exists now)

| Piece | File | Notes |
|---|---|---|
| Variant-level profiles | `lib/parts.ts`, `shopify-data.ts` `loadMembership` | `Parts` = product to variants per profile. Capped or unknown variant counts are treated as whole, with a note on the Overview. |
| Zone rates | `parse.ts` `deriveShipping`, `shopify-data.ts` `loadZoneRates` | If the rate read fails the app assumes rates exist and says so (issue "Shipping rates could not be read"). |
| Recheck / read-back | `lib/readback.ts`, `lib/runPlan.ts` | Pure `findDrift` / `findMismatch` plus reads. |
| Safe apply screen | `components/RunFlow.tsx` | Used by Move, Unpublish fix, Unify fix. |
| Change report | `lib/report.ts` | CSV only, built in the browser. Cells that start with `=`, `+`, `-`, `@` are defused. |
| Product check | `lib/check.ts`, `views/check.tsx`, route `/check` | Reads the product fresh. Markets, countries, catalogues, profiles, and a per-variant table when variants differ. |
| Contract test | `lib/runPlan.test.ts` | Real `applyMove` / `runPlan` against a fake Shopify, including a silent no-op. |

Still unverified against the real Shopify (one canary run settles them): `deliveryProfileUpdate` `variantsToAssociate`, zone `countries` replace-vs-add, `publishableUnpublish` with market publications, and `DeliveryProfileItem.variants` as a connection (the read falls back to products only and the Overview says split products cannot be detected).

## 10. Added 2026-10-26: Channels & catalogues page

Bulk enable/disable of sales channels and add/remove of catalogues for a filtered selection, including the Global market. Uses the same safe flow as moves (recheck, first-product trial, read-back, CSV). See `CLAUDE.md` for the design and the unverified calls.

## 11. Added 2026-10-26: Storefront links page

Read-only page: per-market storefront links for the products you pick, for the live theme or a preview theme, with a CSV export. Needs the `read_themes` scope for the theme list (manual theme id works without it).
