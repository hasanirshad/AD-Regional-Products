import { useMemo } from "react";
import { MISSING_FIELDS } from "../../lib/editor/bulk";
import type { SectionId } from "../../lib/filters/filterModel";
import { baseOptions } from "../../views/filter-state";
import { useAppState } from "../../views/state";
import type { BulkState } from "../../views/bulk-state";
import type { EditorShared } from "../../views/editor-state";
import type { ProductsLoad } from "../../views/products-state";
import { SearchFilterBar } from "../filters/SearchFilterBar";
import type { FilterOptions } from "../filters/FilterPopup";

/** The sections of Bulk edit (the product table and Variants mode). */
export const BULK_SECTIONS: SectionId[] = ["status", "vendor", "productType", "collection", "tag", "tagNot", "catalog", "market", "variants", "translations", "metafield"];
const TRANSLATION_MODES = ["missing", "complete"] as const;

/**
 * The standard search and filter bar for Bulk edit. The same bar is used by both modes (products and variants).
 * "Missing translation" and "metafield" need values from Shopify: they judge the products read so far.
 */
export function BulkFilterPanel({ bulk, shared, products }: { bulk: BulkState; shared: EditorShared; products: ProductsLoad }) {
  const { markets, collections } = useAppState();
  const base = useMemo(() => baseOptions(products.rows, markets), [products.rows, markets]);
  const defs = shared.productDefs.data;
  const collectionOptions = useMemo(() => (collections.list.data ?? []).map((c) => ({ value: c.id, label: c.title })), [collections.list.data]);
  const options = useMemo<FilterOptions>(
    () => ({
      ...base,
      collection: collectionOptions,
      collectionState: collections.list.status,
      collectionError: collections.list.error,
      slots: shared.slots.map((s) => ({ value: s.key, label: s.label })),
      metafields: (defs ?? []).map((d) => ({ value: `${d.namespace}.${d.key}`, label: `${d.name} (${d.namespace}.${d.key})` })),
      valuesNote: `Translations (${MISSING_FIELDS.length} texts per language) and metafield values are read in the background, for the products read so far. Use "Load all" to read the rest.`,
    }),
    [base, collectionOptions, collections.list.status, collections.list.error, shared.slots, defs],
  );
  const notes = useMemo(() => {
    const out: string[] = [];
    if (bulk.unreadForSearch > 0) out.push(`${bulk.unreadForSearch} product${bulk.unreadForSearch === 1 ? "" : "s"} still loading: their columns are not searched yet`);
    for (const id of bulk.filters.collection) if (collections.errors[id]) out.push(`The collection could not be read: ${collections.errors[id]}`);
    return out;
  }, [bulk.unreadForSearch, bulk.filters.collection, collections.errors]);

  return (
    <SearchFilterBar
      filters={bulk.filters}
      onChange={bulk.setFilters}
      sections={BULK_SECTIONS}
      options={options}
      translationModes={[...TRANSLATION_MODES]}
      notes={notes}
      onOpen={() => {
        collections.list.load();
        shared.productDefs.load();
        shared.info.load();
      }}
    />
  );
}
