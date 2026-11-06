// Choose the product to edit: the standard search and filter bar over the store's products, or one of the pinned products.
// The search also asks Shopify (title, handle or SKU), so a product that is not loaded yet, or is found by its SKU, still shows up
// under the list. Pins are saved inside Shopify and need the password.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liveGql, messageOf } from "../../lib/editor/gql";
import { searchProducts, type FoundProduct } from "../../lib/editor/load";
import { saveBookmarks, type Bookmark } from "../../lib/editor/settings";
import { STATUS_LABEL } from "../../lib/editor/model";
import { countActive, type SectionId } from "../../lib/filters/filterModel";
import type { ProductRow } from "../../lib/types";
import { useListFilters } from "../../views/filter-state";
import type { EditorShared } from "../../views/editor-state";
import { useStartProducts } from "../../views/products-state";
import { useAppState } from "../../views/state";
import { Loading } from "../Loading";
import { useGuard } from "../PasswordGate";
import { ScopeBanner } from "../ScopeBanner";
import { SearchFilterBar } from "../filters/SearchFilterBar";

const tone = (status: string) => (status === "ACTIVE" ? "success" : status === "DRAFT" ? "warning" : "neutral");
const PICKER_PAGE = 15;
const SECTIONS: SectionId[] = ["status", "vendor", "productType", "collection", "tag", "tagNot", "catalog", "market", "variants"];

type Item = { id: string; title: string; handle: string; status?: string };

const PickRow = memo(function PickRow({ p, current, unsaved, pinned, canPin, onPick, onToggle }: { p: Item; current: boolean; unsaved: boolean; pinned: boolean; canPin: boolean; onPick: (id: string) => void; onToggle: (p: Item) => void }) {
  return (
    <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-button variant={current ? "secondary" : "tertiary"} onClick={() => onPick(p.id)}>
          {p.title}
        </s-button>
        <s-text color="subdued">{p.handle}</s-text>
        {p.status ? <s-badge tone={tone(p.status)}>{STATUS_LABEL[p.status] ?? p.status}</s-badge> : null}
        {unsaved ? <s-badge tone="info">Unsaved changes</s-badge> : null}
      </s-stack>
      <s-button variant="tertiary" disabled={!canPin || undefined} accessibilityLabel={pinned ? `Unpin ${p.title}` : `Pin ${p.title}`} onClick={() => onToggle(p)}>
        {pinned ? "Unpin" : "Pin"}
      </s-button>
    </s-stack>
  );
});

export function ProductPicker({ shared, onPick, current, pendingIds }: { shared: EditorShared; onPick: (id: string) => void; current: string | null; pendingIds: Set<string> }) {
  const guard = useGuard();
  const { markets, products, pickerUi: ui, collections } = useAppState();
  useStartProducts(products);
  const { filters, setFilters, page, setPage } = ui;
  const [found, setFound] = useState<FoundProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const seq = useRef(0);
  const settings = shared.settings.data;
  const bookmarks = settings?.bookmarks ?? [];
  const pinned = useMemo(() => new Set(bookmarks.map((b) => b.id)), [bookmarks]);

  const result = useListFilters({ rows: products.rows, ui, markets, collections, sections: SECTIONS });
  const list = result.list;
  const pages = Math.max(1, Math.ceil(list.length / PICKER_PAGE));
  const at = Math.min(page, pages - 1);
  const pageRows = list.slice(at * PICKER_PAGE, (at + 1) * PICKER_PAGE);

  // Shopify searches the same words (title, handle and SKU). Its extra finds are shown under the list, when only the search is on:
  // they carry no tags or vendor, so the other filters cannot be applied to them.
  const query = filters.search.trim();
  const onlySearch = countActive(filters) === 0;
  useEffect(() => {
    if (query.length < 2) {
      setFound([]);
      setBusy(false);
      setError("");
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      searchProducts(liveGql, query)
        .then((r) => id === seq.current && (setFound(r), setError("")))
        .catch((e) => id === seq.current && setError(messageOf(e)))
        .finally(() => id === seq.current && setBusy(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);
  const shownIds = useMemo(() => new Set(list.map((p) => p.id)), [list]);
  const extra = onlySearch ? found.filter((f) => !shownIds.has(f.id)) : [];

  const toggle = useCallback(
    (p: Item) => {
      if (!settings) return;
      const next: Bookmark[] = pinned.has(p.id) ? bookmarks.filter((b) => b.id !== p.id) : [...bookmarks, { id: p.id, title: p.title, handle: p.handle }];
      guard.ask(async () => {
        setNote("");
        try {
          await saveBookmarks(liveGql, settings.installationId, next);
          shared.settings.set({ ...settings, bookmarks: next });
        } catch (e) {
          setNote(`Not saved: ${messageOf(e)}`);
        }
      });
    },
    [settings, pinned, bookmarks, guard, shared.settings],
  );

  const row = (p: Item) => <PickRow key={p.id} p={p} current={p.id === current} unsaved={pendingIds.has(p.id)} pinned={pinned.has(p.id)} canPin={Boolean(settings)} onPick={onPick} onToggle={toggle} />;
  const asItem = (p: ProductRow): Item => ({ id: p.id, title: p.title, handle: p.handle, status: p.status });
  const notes = [...result.notes, ...(products.status === "loading" || products.status === "idle" ? [`${products.loaded} products loaded so far; the list is still loading`] : [])];

  return (
    <s-section heading="Product">
      {guard.modal}
      <s-stack gap="base">
        <SearchFilterBar filters={filters} onChange={setFilters} sections={SECTIONS} options={result.options} notes={notes} onOpen={result.onOpen} />
        {products.status === "ready" ? <ScopeBanner scope={products.scope} count={products.rows.length} onChange={products.setScope} /> : null}
        {products.status === "error" ? <s-text tone="critical">{`The product list could not be read: ${products.error}`}</s-text> : null}
        {products.status === "loading" || products.status === "idle" ? <Loading message="Reading the products…" /> : null}
        {products.status === "ready" ? (
          <s-stack gap="small-100">
            <s-text color="subdued">{`${list.length} of ${products.rows.length} products`}</s-text>
            {list.length === 0 ? <s-text color="subdued">{result.waiting > 0 ? "No products to show yet." : "No product matches. Change the search or the filters."}</s-text> : pageRows.map((p) => row(asItem(p)))}
            {list.length > PICKER_PAGE ? (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-button disabled={at === 0 || undefined} onClick={() => setPage(at - 1)}>
                  Previous
                </s-button>
                <s-text color="subdued">{`Page ${at + 1} of ${pages}`}</s-text>
                <s-button disabled={at >= pages - 1 || undefined} onClick={() => setPage(at + 1)}>
                  Next
                </s-button>
              </s-stack>
            ) : null}
          </s-stack>
        ) : null}
        {busy ? <Loading message="Searching Shopify…" /> : null}
        {error ? <s-text tone="critical">{error}</s-text> : null}
        {extra.length > 0 ? (
          <s-stack gap="small-100">
            <s-text type="strong">Also found in Shopify (SKU, or not loaded yet)</s-text>
            {extra.map((p) => row(p))}
          </s-stack>
        ) : null}
        {bookmarks.length > 0 ? (
          <s-stack gap="small-100">
            <s-text type="strong">Pinned</s-text>
            {bookmarks.map((b) => row(b))}
          </s-stack>
        ) : null}
        {note ? <s-text tone="critical">{note}</s-text> : null}
        {shared.settings.status === "error" ? <s-text color="subdued">{`Pins could not be read: ${shared.settings.error}`}</s-text> : null}
      </s-stack>
    </s-section>
  );
}
