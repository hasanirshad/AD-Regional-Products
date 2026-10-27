# Product editor: Edit product and Bulk edit

Added 2026-10-28. Two pages in AD Regional Products: **Edit product** (`/edit`) and **Bulk edit** (`/bulk`).
They change product content (title, description, SEO, handle, vendor, type, category, status, tags, price and
compare-at, stock, metafields) and translations of those fields. Product first: you pick the product, then the field.
(AD MetaFields is the opposite: metafield first.)

## Rules these pages follow

- Reads are free. **Every write**: review (nothing written) → ticked confirmation → password (`useGuard`, and `adminGraphql`
  refuses a mutation outside `runUnlocked`). All saves go through the shared `RunFlow` (recheck, optional first-product trial,
  read-back, CSV report).
- **No automatic translation.** Translations are typed or pasted. The only helper is "Copy the source into empty languages"
  and a person confirms it.
- **No media.** Prices are for the primary market only (price + compare-at). Other markets' prices stay in Shopify Markets.
- **No database.** Anything saved lives inside Shopify (below).
- Admin API `2026-07` (same as the rest of the app).

## Edit product

Product picker (Shopify searches title, handle or SKU; pins), then tabs: Basic data, SEO, Product metafields, Variant
metafields, Type and category, Inventory, Tags, Prices. On every text field the source value and one box per market
language sit side by side with a status: translated, missing, same as source, outdated, no source text.
A sticky **Changes** bar counts edits across all tabs; **Review changes** lists them all (now / after) with ONE confirmation
and ONE password. Edits stay while you move between tabs, products and languages (no reloads); leaving the page with
unsaved edits asks first. After a save, **Undo** (banner) can put the last save back.

**Metafield tabs** show only the rows chosen this session in "Choose metafields" (grouped by namespace, searchable, name +
`namespace.key` + type; removing a row only hides it). Chosen rows can be saved as named **sets**. Type-aware inputs and checks:
text, multi-line, rich text (round-trip only), integer, decimal, dimension/weight/volume (unit), boolean, date, date-time,
colour, URL, JSON, rating, money, lists (add, remove, up/down), choice lists (from the definition's choices), references
(Shopify resource picker). Read-only types say why (file, metaobject, mixed, page/article/customer/company references,
some lists, rich text that cannot round-trip). Translations are offered only for text, multi-line text and URL, and only
for a metafield that exists.

**Create product** (steps: Basics, SEO, Metafields, Variants, Type, Tags, Prices): step 1 makes a real **DRAFT** product
(`productCreate`, status DRAFT) and saves `draft_state`. Later steps use the normal tabs; "Save my place and continue" is a
normal reviewed save that also moves `draft_state` to the next step. **Continue where I left off** lists draft products that
carry `draft_state`. The product becomes ACTIVE only on "Finish and make active" (review + confirmation + password); that
save also deletes `draft_state`. Variants step: options are created once (`productOptionsCreate`, variantStrategy CREATE)
for a product that still has only the default variant.

## Bulk edit

Table (one row per product) sortable on any column; columns chosen by you: product fields, price and compare-at (products
with ONE variant only), product metafields (inline-editable types; others shown only), and translations of title,
description, SEO title, SEO description, handle, product type per language. Filters: status, vendor, type, tag, collection,
market catalogue (in / not in), missing translation in a language, empty metafield. Edit inline or **paste from a
spreadsheet** (row 1 = column names, first column = Handle, ID or Title; empty pasted cell = no change; `[clear]` empties).
An empty cell means "none" (deletes a metafield or translation). Quick subset first (100 products), then **Load all**.
Review shows old → new per row; failures are per row after the run; **Undo** of the last run (shared with Edit product).
Content filters and value sorting judge only the products loaded so far; the page says how many are still waiting.

## Where things are saved (decision: storage inside Shopify)

The prompt said "on the shop". The app has no database and no server, so everything it remembers is an **app-owned
metafield** (`$app` namespace; only this app can write them):

| Where | Key | What |
|---|---|---|
| App installation (one per store, shared by all staff) | `editor_sets` | named sets of metafield rows |
| App installation | `editor_bookmarks` | pinned products |
| App installation | `editor_undo` | the last save, so Undo survives a reload (not stored if over 1.5M characters; Undo then lasts until reload) |
| A draft product | `draft_state` | the step reached in Create product + the chosen rows |

Why the installation and not the shop: no extra scope, it is shared by everyone who opens the app, and AD MetaFields does the
same. Uninstalling deletes the installation metafields (products and drafts stay). Every save of these asks for the password.

## Scopes

New in the app config (need `npm run deploy`, then approve in the store):

| Scope | Why |
|---|---|
| `write_translations` | `translationsRegister` / `translationsRemove` (translations of fields and text metafields) |
| `read_locales` | `shopLocales`: which languages the store has and which is primary |

Already present and now also used: `write_products` (productUpdate, productVariantsBulkUpdate, metafieldsSet/Delete,
productCreate, productOptionsCreate, app metafields), `read_products`, `read_translations` (source values and digests),
`write_inventory` and `read_locations` (stock per location), `read_markets` (market languages).

## Code map

`app/lib/editor/`: `richtext, mfTypes, mfRules` (type rules and validation), `model` (Target, Value, Change), `edits`, `changes`
(buildChanges, undoChanges), `doc`, `load`, `read`, `apply` (order: product fields → handle → variants → metafields → stock →
translations; a failed step halts the rest for that product), `run` (editorEngine, 3-lane pool, read-back), `settings`
(app metafields), `create`, `locales`, `bulk`, `bulkLoad`, `gql`, `pool`, `canon`, `fake` (fake Shopify for tests).
`app/views/`: `edit.tsx`, `bulk.tsx`, `edit-state.ts`, `bulk-state.ts`, `editor-state.ts`. `app/components/editor/`: tabs, value editor,
metafield chooser, review, changes bar, undo bar, create wizard, bulk table / columns / paste.

## Tests

- 478 unit tests across 39 files (all of the app). Editor logic is tested against `FakeShopify`, which can refuse an
  operation or say "ok" and change nothing (read-back must catch it): plan/apply order and halting, run + read-back, create
  flow, settings parse/serialize, type parsing/validation per metafield type, rich text round trip, bulk columns, cell
  parsing, filters, sort, TSV paste, undo.
- A Chromium smoke run was done in the cloud against `build/client` with a fake Shopify (not part of the repo): picker, all
  eight tabs, edit + translation + metafield rows with validation errors, review → password → apply → read-back,
  Undo, create draft → step save → resume → finish to ACTIVE, Bulk sort / filter / cell edit / paste / apply (with
  first-product trial) / Undo. The Polaris script was stubbed, so inputs were driven by setting `.value` and dispatching
  events; the real Polaris components were NOT exercised.

### Test plan on the real store (do in this order; stop at the first surprise)

1. Open **Edit product**, pick a product. Reads only: check source values and the language list match the store.
2. Change one SEO title in one language on a test product; review → save. Check it in Shopify (Translations). Then Undo.
3. Product metafields: choose one text metafield, edit, save, read back. Then an integer and a boolean.
4. Change a handle with the redirect box ticked; check the old URL redirects.
5. Inventory: change one quantity on a test product (see the Inventory notes in CLAUDE.md).
6. Create product: make a draft, save two steps, reload, "Continue where I left off", finish. Check `draft_state` is gone.
7. **Bulk edit**: change 2 tags on 2 products; use the first-product trial. Then Undo.
8. Bulk paste of 10 rows with one bad handle; check the plan message and the failures list.

## Calls not yet seen on the real store (unverified)

`productOptionsCreate` with `variantStrategy: CREATE`; `taxonomy.categories` fields (`id name fullName isLeaf`);
`inventorySetQuantities` with `changeFromQuantity`; `productUpdate` `redirectNewHandle`; `shopLocales` (needs `read_locales`);
metafield translations (text, multi-line, URL only are offered); `$app` metafield on a product and on the installation;
`shopify.resourcePicker` for reference rows; `collections` / `collection.products` reads; `translationsRegister` /
`translationsRemove` (needs `write_translations`). Every write is read back, so a silent failure shows as "not verified".

## What the API could not do / limits

- No UI for market-specific translations (`en@market` style); the model supports it, the pages do not show it.
- Bulk price columns apply to single-variant products only (multi-variant products show "Several variants").
- Bulk metafield columns are editable only for single inline types; lists, references and rich text are shown only.
- Bulk has no metafield translations.
- Create product: variants step builds options only for a product that still has the default variant; up to 3 options
  and 100 variants.
- Category: leaf categories only. Description is edited as raw HTML.
- A product saved by someone else after you opened it: the recheck before writing stops the run and says which field changed.
- The Undo record is stored in Shopify only if it is under 1.5M characters.
- Metafield definitions: first 250 per kind are read.
