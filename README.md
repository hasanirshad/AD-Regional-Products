# Regional Products

Invite-only embedded Shopify app for Hardman Design. Shipping profiles are the groups: the app reads every profile in the store and helps you check and change where products can be bought.

## What it does

1. **Overview** (home, read only): problems to fix, counts, markets, shipping profiles, products by profile and market, checkout by country, catalogues, and every product. Every number opens the matching products.
2. **Products**: search and filter (status, vendor, type, tag, catalogue, profile), select products across pages, and move them into a shipping profile.
   Moving is a 3-step flow: choose the profile, review exactly what will change (shipping profile moves, catalogue publishes and unpublishes, per market), then apply after ticking a confirmation.

Checkout is blocked by the shipping profile (a product only ships to the countries in its profile's zones). Visibility is the market catalogues: the move can publish where the profile can ship and unpublish where it cannot.

## Rules

- No server, no database, nothing saved by the app. Everything is read live from Shopify.
- Reads never ask for anything. **Every change asks for the password** (`lib/guard.ts`, SHA-256 of the password in the code). `adminGraphql` refuses any mutation that did not pass the password dialog, so a new write cannot skip it. This is a guard against accidents, not security.
- The app never creates or edits shipping profiles or their zones and rates. Make them in Shopify under Settings → Shipping.
- The market named `Global` with handle `de` is hidden on purpose (`lib/hidden.ts`): not listed, not counted, its catalogue ignored.
- Market catalogue publishing only affects the online store, not draft orders.

## Where things are

- Pure logic with tests: `lib/overview.ts` (states, issues, filters), `lib/move.ts` (what a move changes), `lib/filter.ts`, `lib/parse.ts`, `lib/guard.ts`.
- Shopify calls: `lib/shopify-data.ts` (reads), `lib/applyMove.ts` (writes), `lib/admin.ts` (client with retry and the write lock).

## Run it

There is one app, `AD Regional Products`, config `shopify.app.production.toml`. No tunnel and no separate dev app.

1. Node 22 (`.nvmrc`), then `npm install`.
2. Before each push: `npm test`, `npm run typecheck`, `npm run build`.
3. Push to `master`. Cloudflare Pages builds `build/client` (env: `SHOPIFY_API_KEY` = the app's client id, `NODE_VERSION` = 22).
4. Reload the app inside the store admin. After changing scopes or URLs in the toml, run `npm run deploy`.

## Notes

- Scopes and `api_version` in the toml are a first guess and **unverified**. Check them on the first install.
- The calls that move variants and publish products (`lib/applyMove.ts`) are unverified on a real store. Test with one or two products first.
- Nothing is pushed to `master` without Hasan's go-ahead.
