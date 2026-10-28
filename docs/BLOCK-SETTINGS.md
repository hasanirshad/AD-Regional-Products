# Block settings and market adaptations (added 2026-10-28)

The page **Block settings** (`/settings`, nav "Block settings") is where the seven Product Insights blocks are configured, and
where Hasan chooses which **market adaptations** the editor offers. Nothing here changes a product, a price or a translation.

## Storage decision (no server, no database)

ONE JSON value in an app-owned metafield: namespace `$app`, key `block_settings`, type `json`, **on the app installation**.

- The brief said "on the shop". The installation is the same place as the editor's saved sets (`editor_sets`, `editor_bookmarks`,
  `editor_undo`): it needs **no extra scope**, only this app can write it, every staff member shares it, and it is removed when the app is
  uninstalled. A metafield on the `Shop` object would need an extra scope and a metafield definition. Decide again only if the
  settings must be readable by a theme or another app (then they would have to move to the shop).
- **No metafield definition is created.** An app-owned metafield on the app installation does not need one (`metafieldsSet` creates it),
  and its shape is checked by the app instead (`parseSettings` / `problemsOf`). The "definition" is therefore this spec:
  `$app` / `block_settings`, type `json`, value `{ version: 1, languages, translation, quality, links, markets, sale, collections, activity, adaptations }`
  (type `BlockSettings` in `extensions/shared/settings.ts`). A value larger than 100,000 characters is refused.
- Reads are free. Saving needs the password through `useGuard().ask`; `adminGraphql` refuses a mutation outside `runUnlocked`.

## How the blocks use it

`extensions/shared/settings.ts` is the single place for the shape, the defaults, the value rules and the reader. Pure TypeScript: the
blocks (Preact) and the app (React) import the same file.

- `defaultSettings()` builds today's behaviour from `constants.ts` (so the constants file is now the **defaults**, not the only source).
- `parseSettings(raw)` never throws. Nothing saved: defaults, quietly. Not JSON, not an object, a newer version or too long: all defaults,
  reported. A **section** that is the wrong shape or breaks a value rule: only that section takes its defaults (reported), the rest is kept.
  A section missing from an older save takes its default quietly.
- `readSettings(soft)`: `currentAppInstallation { metafield(namespace:"$app", key:"block_settings") { value } }` through the block's soft query.
  If the read fails, the block still loads with the defaults and says so in one grey line under the block.
- `defineBlock` (`shared/ui.tsx`) reads the settings first, then calls the block's `load` with `ctx.settings`. A test that calls `load` without
  settings gets the defaults. Changes show in the blocks **on the next load** of the product page.
- Bundle sizes stay at 32 to 38 KB (limit 64 KB).

## The tabs

| Tab | Settings | Block |
|---|---|---|
| Translation status | languages (from the store's languages); rows: core fields (title, description, SEO title, SEO description, handle), a product metafield (picked from the store's definitions), all metafields of a namespace, option names, option values; reorder; remove | Translation status, languages also for Sale and badge |
| Data quality | every check on/off, reorder, remove; add from the catalogue (image, alt text, variant titles, SEO, price above zero, market publication, length and seater, lead time); custom check "metafield X must not be empty" (product or every variant); the metafield keys for length, seater and lead time | Data quality checklist |
| Quick links | preview theme id (digits, a pasted theme address or GID is turned into the id), market used for the preview, storefront domain and `?stay_us=1` per market | Quick links |
| Market availability | the markets listed (on/off, order, short code, name, country, optional market handle), add a market of the store | Market availability, Sale and badge, Quick links |
| Sale and badge | badge metafield (a product definition), sale collection handle (empty = skip that check) | Sale and badge |
| Collections and tags | show the collection type, show tags | Collections and tags |
| Recent activity | events to list (1 to 50) | Recent activity |
| Market adaptations | Language + Market + "Add adaptation"; list with Remove | Edit product and Bulk edit (see below) |

Behaviour: every value is checked as it is typed and the error shows under the field (`problemsOf`). Metafield keys are checked against the
store's real definitions (`problemsAgainstDefinitions`): the metafield lists only offer definitions, and a key that is not a definition **blocks
the save when it was set now**. A key that was already saved (or is a default, for example `custom.variant_length` if the store does not have it)
is shown as a yellow **warning** and does not block an unrelated change. "Reset to defaults" is per tab (`resetTab`; the market domains belong to
the Quick links tab, the rest of a market to the Market availability tab). "Preview how the block will look" runs the block's own code
(`translation-status` `shape`, `data-quality` `evaluate`, `quick-links` `buildLinks`) on a made-up product (`lib/editor/blockPreview.ts`).
Empty, loading, error (with "Try again") and slow ("Saving, then reading back…") states are shown. The draft lives in the layout, so moving
to another page does not lose it.

## Saving

Review lists every change in words (`diffSettings`: tab, what, now, after saving). Then one ticked confirmation, the password, then
`saveBlockSettings`: refuse values that break the rules, **recheck** that the stored text is still the one the page opened with (someone
else saved: nothing is written), `metafieldsSet`, **read back** and compare. One primary button per view ("Review changes", then "Save changes").

## Market adaptations (language adapted for a market)

Settings: `adaptations: [{ locale, marketId, marketName }]`. In the editor each one becomes a slot `en@gid://shopify/Market/<id>` labelled
"English · United States" (`slotsWithAdaptations` in `lib/editor/locales.ts`), shown next to the language boxes in Edit product (every
translatable field and metafield) and offered in Bulk edit (columns, "Missing translation in" filter). Saving writes
`translationsRegister` with `marketId`; Undo and read-back already handled market slots. An adaptation whose market no longer exists
(markets are read live) or whose language left the store is hidden; its texts stay in Shopify. Removing an adaptation only hides its boxes.
The Edit page waits for the settings (`shared.ready`) so the boxes are final before a product is read; when the slots change the open
products are read again.

## Handles and SKUs (asked for with this task)

- URL handle translations: the Translation status block has a "Handle (URL)" row (a core row you can remove or reorder), and Edit product
  has the handle translatable in every language box.
- SKU: Edit product, Inventory tab, "SKU" per variant (already there). **New:** Bulk edit has SKU and barcode columns next to price and
  compare-at (only for products with one variant; others are edited in Edit product).

## Not verified (nothing here has run against the real store)

- The block reading `currentAppInstallation.metafield` with the `$app` namespace from inside an admin block with direct API access. If the
  read is refused the blocks show their defaults and a grey line "Settings could not be read"; check the block on one product first.
- `metafieldsSet` of a `json` metafield on the app installation with the `$app` namespace (the editor already writes sets this way, but
  verify it on the store).
- Market-specific translation of the store's **main** language (English for a market): Shopify's `translationsRegister` with `marketId`
  is used for it; confirm on one product that Shopify accepts it and shows it on the storefront.
- The Polaris components themselves (switch, select, checkbox): the Chromium smoke run stubbed them. Open the page once in the admin.
- Metafield definitions of the `$app` namespace are not listed as choices; only the store's own definitions are.

## Tests

`extensions/shared/settings.test.ts` (defaults, invalid data, rules, definitions, the reader), `extensions/blocks-settings.test.tsx` (every
setting changes what a block asks for or shows), `app/lib/editor/blockSettings.test.ts` (tabs, reset, diff, **the password gate**, recheck,
read-back), `app/lib/editor/blockPreview.test.ts` (previews, adaptation slots). A one-off Chromium run against the fake store covered the
whole page: tabs, inline errors, review, password, save and what was stored, reset, discard, a broken saved value, a failed read, and an
adaptation box in Edit product and Bulk edit (written with `marketId`, read back).
