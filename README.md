# Regional Products

Invite-only embedded Shopify app for Hardman Design. It will:

1. define **groups** (a name plus allowed countries) and keep one shipping profile per group,
2. let you **filter and pick products** and assign them to a group,
3. **move products with a review step**: move variants into the group's shipping profile and publish them only in markets where checkout works.

No server, no database. Built to the APPSDAPPS Shopify App Playbook (React Router 7 SPA, Polaris web components, direct API access, Cloudflare Pages).

## Status

Done so far:
0. **Overview** (home): problems to fix, counts, markets, groups and profiles, products by group and market, checkout by country, catalogues, and every product. Read-only.
1. **Groups** page: list, create, edit, preview.
2. **Products** page: search and filters (status, vendor, type, tag, catalogue, group), selection across pages, and staging moves into a group. Moving products is a 3-step flow: choose a target, review exactly what will change (shipping profile moves, catalogue publishes and unpublishes, per market), then apply after ticking a confirmation. Nothing is written before that.

There is no separate Sync page and no staging: every write goes through the review step.

- Groups are saved in one app metafield (`$app/groups`). Each group gets a shipping profile named `Group: <name>`, built from the General profile narrowed to the group's countries. Flat rates and weight/price conditions are copied; carrier-calculated rates are listed as "not copied".
- Saving a group does **not** touch products or markets.
- Pure logic with tests: `lib/plan.ts`, `lib/parse.ts`, `lib/groups.ts`. Shopify calls: `lib/shopify-data.ts`, `lib/saveGroup.ts`.

## Run it

1. Node 22 (`.nvmrc`), then `npm install`.
2. Link the dev app with `npx shopify app config link` (the live config is `shopify.app.regional-products.toml`).
3. `npm run dev`, choose the dev app and the store `dev-appsdapps`, open the preview link and test **inside the admin**.

Before each handoff: `npm test`, `npm run typecheck`, `npm run build`.

## Notes

- `shopify.app.toml` scopes and `api_version` are a first guess and **unverified**. Check them on `dev-appsdapps`.
- Nothing is pushed to `master` (the release) without Hasan's go-ahead.
