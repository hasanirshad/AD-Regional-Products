# Product editor: Product Edits and Bulk edit

Added 2026-10-28. Two pages in AD Regional Products: **Product Edits** (`/edit`, called *Edit product* until 2026-11-02) and **Bulk edit** (`/bulk`).
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

## Product Edits (rebuilt 2026-11-02)

One page to make a draft product or edit an existing one, in the same steps, with every text next to its translations so the content
manager never changes page to translate and nothing is missed. **The app never makes a product active**: it saves the product as it
is (a new one as a DRAFT) and shows an **Open in Shopify** link and a **Preview** link (`onlineStorePreviewUrl`) at the top; activating is done in Shopify.

**Top of the page:** a **Create / Edit** toggle.
- *Create*: one box (title) and **Create draft product**. This is a write, so it is reviewed, ticked, password-protected (`createEngine` through `RunFlow`),
  vendor "Hardman Design". It then opens step 1. Below: **Continue where I left off** (draft products that carry `draft_state`).
- *Edit*: the product picker (search by title, handle or SKU; pins), then the same steps.
- The **step strip** is always visible and every step opens at any time, in both parts. Each step shows how many unsaved edits it holds.
- **Save and next** (footer): with changes waiting it shows the review, asks for the password, saves, then moves on; with none it just moves on.
  A sticky **Changes** bar counts edits across all steps ("Review all changes" saves everything at once).

**The 11 steps** (`lib/editor/productSteps.ts`):

| # | Step | What it holds | Translated |
|---|---|---|---|
| 1 | Product info | title, description (rich text), product type; Vendor (default Hardman Design); PDP template (read from the live theme); In stock / Made to order; (more: category, tags, status) | title, description, type |
| 2 | Variants | up to 3 options, values, drag (or arrows) to set the order shown on the product page; names in every language | option and value names |
| 3 | Inventory & prices | one tile per variant titled "option1 / option2 / option3": SKU, CAP, sale price (read only), tracked, locations and quantities | no |
| 4 | Variant details | sub-tabs **Sizes & dimensions** and **Swatches & visibility** (variant metafields; copy first variant to all) | no |
| 5 | Product options | sub-tabs **Options & customisation** and **Related & recommended** | text values |
| 6 | Content | tag line, wood type, material, dimension section, other text metafields | yes, beside each text |
| 7 | Lead times | delivery / production metafields (not "Build and Delivery time"); stock delivery shown for stock products | no |
| 8 | SEO | SEO title and description with translations; URL handle (no translation) | title, description |
| 9 | Images & files | image, video and document (PDF) metafields, with the file picker | never |
| 10 | Publishing | sales channels and market catalogues | no |
| 11 | Review | one tab per language: main language on the left, that language on the right; **Review changes and save** | read only |

**Rules decided on the way (change them if wrong):**
- **CAP = compare-at price.** You type the CAP; the price copies it (the sale price is read only). A sale that is already running (price below CAP) is left alone, with a note.
- **Stock vs made to order** (step 1 and again on step 3): made to order = inventory not tracked, each variant at "Hardman Möbel Ltd. | London"
  (found by name; if absent you choose) with no quantity; stock = tracked, quantity 1 per variant. Switching changes every variant and each can still be edited.
  Only a **draft made here** is stocked automatically; an existing product is never changed on its own.
- **Options** are saved by their own reviewed run (`lib/editor/optionsPlan.ts`, `optionsEngine`): create (or update), read back ids, order, translations, read back. Removing an option or a value is **not** offered (it deletes variants; do that in Shopify). When a product with only the default variant gets options, unsaved edits on the default variant are dropped (the review says so).
- **Translations of a metafield that has no value yet** are held and attached after the value is saved in the same run (`lib/editor/deferred.ts`). If the value is empty the translation fails with a clear message.
- **Metafield screens** are filled by matching the store's definitions by NAME to each screen (`lib/editor/curated.ts`; "Build and Delivery time" never). A definition the groups do not claim goes under **Add another metafield** (or is shown when it already holds a value). Variant metafields are read only for the keys shown.
- **Value inputs** match the type: text, multi-line, rich text, numbers, dimension/weight/volume, boolean, date, colour, URL, JSON, rating, money, lists, choices, product / variant / collection references (Shopify picker), **metaobject entries** and **files** (own picker: search, thumbnails, "Load more"). Uploading a new file is NOT included: pick files already in Shopify > Content > Files.
- No automatic translation. "Copy the source into empty languages" is still a confirmed helper.

## Edit product (before 2026-11-02, kept for reference)

The earlier version had tabs (Basic data, SEO, Product metafields, Variant metafields, Type and category, Inventory, Tags, Prices) and a 7-step Create
wizard. Its pieces are reused: `TranslatableField`, `CategorySection`, `TagsTab`, `MetafieldRow`, `ValueEditor` and the shared review.
`draft_state` of drafts made then is mapped to the nearest new step (`normalizeStep`).

## Bulk edit

Table (one row per product) sortable on any column; columns chosen by you: product fields, price and compare-at (products
with ONE variant only), **SKU and barcode** (one-variant products only; added 2026-10-28), product metafields (inline-editable types; others shown only), and translations of title,
description, SEO title, SEO description, handle, product type per language. Filters: status, vendor, type, tag, collection,
market catalogue (in / not in), missing translation in a language, empty metafield. Edit inline or **paste from a
spreadsheet** (row 1 = column names, first column = Handle, ID or Title; empty pasted cell = no change; `[clear]` empties).
An empty cell means "none" (deletes a metafield or translation). Quick subset first (100 products), then **Load all**.
Review shows old → new per row; failures are per row after the run; **Undo** of the last run (shared with Edit product).
Content filters and value sorting judge only the products loaded so far; the page says how many are still waiting.

## Bulk edit: Variants mode (added 2026-10-30)

A switch at the top of Bulk edit, **Edit variants** (off by default = the product table above). Unsaved edits of the other mode are kept.

1. **Choose products.** The same search and filters as the product table (`BulkFilterPanel`), then tick products (this page, all matching, up to 200).
   Ticks survive a change of filters.
2. **Choose columns.** Variant fields (price and compare-at of the primary market, SKU, barcode), **variant metafields** (inline types editable, others shown
   only) and, for each chosen text / multi-line text / link metafield, a **translation column per chosen language and per market adaptation**. The slots are
   `shared.slots`, so they follow Block settings > Languages and adaptations (nothing is hard-coded).
3. **Edit.** One row per variant (Product, Variant, then the columns). Reads are free, with a Stop button. Saving is the shared flow: review old -> new,
   ticked confirmation, password, recheck, first-product trial, read-back, CSV report, and **Undo**. Labels read like "French · Length · Oak / 180".

Rules and limits:
- A translation belongs to the SAVED metafield (Shopify's translatable resource is the metafield's id). A variant with no value shows "Save the value first":
  save the value, then translate it. After a save the table is read again, so the new id is picked up.
- Reads: 3 products x 100 variants per call, then paging up to **250 variants per product** (more are not shown; the page says which products).
- No paste-from-spreadsheet and no "copy the source" helper in Variants mode yet. Variant option names / values and inventory are not columns here (Edit product
  handles them). Tracked and inventory policy are not offered.
- Code: `lib/editor/bulkVariants.ts` (pure + reads), `views/bulk-variants-state.ts`, `components/editor/{VariantBulk,BulkFilterPanel}.tsx`. 14 new tests against the
  fake Shopify (`bulkVariants.test.ts`: reads, paging, targets, a full save incl. a market adaptation).
- NOT verified on the real store: the `nodes(ids:)` read of 3 products x 100 variants under the cost limit, a translation of a VARIANT metafield (and of a market
  adaptation of it), and the row rendering with the real Polaris components (smoke tests stub them).

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
`app/lib/editor/` also has (Product Edits): `productSteps` (the 11 steps), `curated` (metafield definitions by screen), `optionsPlan` (options plan + engine + drag helpers), `inventoryPlan` (stock mode, default location, CAP), `reviewRows` (language review), `deferred` (translations waiting for a value), `refs` (metaobject and file pickers' data), `templates` (PDP templates).
`app/views/`: `edit.tsx` (Product Edits), `bulk.tsx`, `edit-state.ts`, `bulk-state.ts`, `editor-state.ts`. `app/components/editor/`: `steps/` (StepStrip, StepFooter, InfoStep, VariantsStep, InventoryStep, CuratedStep, SeoStep, PublishingStep, ReviewStep, CreateStart, StockKindToggle), value editor,
reference dialog, metafield chooser, review, changes bar, undo bar, bulk table / columns / paste.

## Tests

- 782 unit tests across 58 files (all of the app; 2026-11-02). Each Product Edits step is also drawn on the server (`components/editor/steps/render.test.tsx`) to catch screens that throw; this is not a click-through. Editor logic is tested against `FakeShopify`, which can refuse an
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
6. Product Edits > Create: make a draft (title only), then Save and next through Product info and Variants (two options, one translation), Inventory, one metafield step. Reload, "Continue where I left off". Open the Preview link. Check the product is still a draft. Do this on a throw-away product first.
7. **Bulk edit**: change 2 tags on 2 products; use the first-product trial. Then Undo.
8. Bulk paste of 10 rows with one bad handle; check the plan message and the failures list.

## Calls not yet seen on the real store (unverified)

`productOptionsCreate` with `variantStrategy: CREATE` (and on a product that already has options); `productOptionUpdate` (`variantStrategy: MANAGE`), `productOptionsReorder`; translations of options and option values (resource types ProductOption / ProductOptionValue); `inventoryActivate` / `inventoryDeactivate` and whether new variants are stocked at a default location on their own; `publishablePublish` / `publishableUnpublish` on a DRAFT product and reading a draft's publications; the theme template read (`files(filenames: ["templates/product.*"])`); `files()` and `metaobjects(type:)` pickers and what they return without scope `read_files`; `onlineStorePreviewUrl` for a draft; `taxonomy.categories` fields (`id name fullName isLeaf`);
`inventorySetQuantities` with `changeFromQuantity`; `productUpdate` `redirectNewHandle`; `shopLocales` (needs `read_locales`);
metafield translations (text, multi-line, URL only are offered); `$app` metafield on a product and on the installation;
`shopify.resourcePicker` for reference rows; `collections` / `collection.products` reads; `translationsRegister` /
`translationsRemove` (needs `write_translations`). Every write is read back, so a silent failure shows as "not verified".

## What the API could not do / limits

- Market-specific translations (`en@market` style) appear only for the **market adaptations** chosen on the Block settings page (`docs/BLOCK-SETTINGS.md`): each one adds a box in Edit product and a column choice and filter entry in Bulk edit. Unverified on the real store, especially for the main language.
- Bulk price columns apply to single-variant products only (multi-variant products show "Several variants").
- Bulk metafield columns are editable only for single inline types; lists, references and rich text are shown only.
- Bulk (product table) has no metafield translations; Variants mode translates variant metafields (see above).
- Variants step: up to 3 options and 100 variants (Shopify allows 2,048); options and values can be added, renamed and reordered, not removed.
- Metafield translations are offered for single text, multi-line text and URL values (not lists, rich text, files or references).
- Files can be picked from Shopify > Content > Files but not uploaded here.
- Category: leaf categories only. Description is edited in the visual editor (HTML view for the code); see "Description editor".
- A product saved by someone else after you opened it: the recheck before writing stops the run and says which field changed.
- The Undo record is stored in Shopify only if it is under 1.5M characters.
- Metafield definitions: first 250 per kind are read.

## Description editor (added 2026-10-29)

Descriptions (source and every language) use a visual editor, not a raw HTML box: `components/editor/RichTextEditor.tsx`.
- Toolbar: text style (paragraph, headings 1 to 4, quote), bold, italic, underline, bulleted and numbered list, link (Ctrl+K; web, mail and phone
  addresses only, `javascript:` is refused), unlink, clear formatting, **Clean up** (removes colours, fonts, classes, ids, comments and empty paragraphs
  from the whole text), undo, redo, and an **HTML** button to see and edit the code.
- Where: Edit product (Basic data tab: the source and each language side by side; "Copy the source into empty languages" still works), Create product
  (step 1) and **Bulk edit** (the Description and every "<language> · Description" column show a short preview and an **Edit** button; the editor opens in a
  dialog, "Use this text" puts it back in the cell as a normal pending edit). In a translation dialog the main-language text can be opened above the
  editor and copied in, when the Description column is also in the table.
- **Opening never changes a description.** The editor shows a safe copy; nothing is sent to the review until the person types. Things that cannot be
  edited as text (videos, iframes, forms, svg, style blocks, scripts) are shown as a locked block (style/script are hidden) and put back exactly as they
  were when the text is read back. Event handlers (`onerror`, `onclick`) and `javascript:` links are removed from what is shown and so from what is saved
  after an edit. `<b>` and `<i>` are saved as `<strong>` and `<em>`. Colours and styles already in the text stay unless Clean up is pressed.
- Pasting keeps structure only (paragraphs, headings, lists, bold, italic, links); colours, fonts and classes from Word or Google Docs are left behind.
- Code: `lib/editor/richHtml.ts` (pure: `plainText`, `previewText`, `isBlankHtml`, `normalizeUrl`; tested in node) and `lib/editor/richDom.ts`
  (`toEditable`, `fromEditable`, `cleanPasted`, `cleanUp`; need a browser, checked in Chromium, not in the unit tests). No library; the editing uses the
  browser's own `contenteditable` commands.
- Checked in Chromium against the fake store (Edit product and Bulk edit, save, read-back). NOT checked: the real Polaris dialog and buttons around it,
  Safari and Firefox, very large descriptions, screen readers. Rich text *metafields* still use the text markup (not this editor).
