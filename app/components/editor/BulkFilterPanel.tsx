import { useMemo } from "react";
import { activeFilterCount, NO_BULK_FILTERS, type BulkFilters } from "../../lib/editor/bulk";
import { filterOptions } from "../../lib/filter";
import type { BulkState } from "../../views/bulk-state";
import type { EditorShared } from "../../views/editor-state";
import type { ProductsLoad } from "../../views/products-state";
import { FilterBar } from "../FilterBar";
import { SelectField } from "../SelectField";

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", DRAFT: "Draft", ARCHIVED: "Archived" };
const ANY = "";

/** Search and filters of Bulk edit. The same panel is used by both modes (products and variants). */
export function BulkFilterPanel({ bulk, shared, products }: { bulk: BulkState; shared: EditorShared; products: ProductsLoad }) {
  const { filters } = bulk;
  const defs = shared.productDefs.data ?? [];
  const options = useMemo(() => filterOptions(products.rows), [products.rows]);
  const set = (patch: Partial<BulkFilters>) => bulk.setFilters({ ...filters, ...patch });
  const slotLabel = (key: string) => shared.slots.find((s) => s.key === key)?.label ?? key;
  const defName = (key: string) => defs.find((d) => `${d.namespace}.${d.key}` === key)?.name ?? key;
  const catalogName = (id: string) => options.catalogs.find((c) => c.id === id)?.title ?? "catalogue";

  const chips: { key: string; label: string }[] = [];
  if (filters.status) chips.push({ key: "status", label: `Status: ${(STATUS_LABEL[filters.status] ?? filters.status).toLowerCase()}` });
  if (filters.vendor) chips.push({ key: "vendor", label: `Vendor: ${filters.vendor}` });
  if (filters.productType) chips.push({ key: "productType", label: `Type: ${filters.productType}` });
  if (filters.tag) chips.push({ key: "tag", label: `Tag: ${filters.tag}` });
  if (filters.collection) chips.push({ key: "collection", label: `Collection: ${bulk.collections.data?.find((c) => c.id === filters.collection)?.title ?? "…"}` });
  if (filters.catalog) chips.push({ key: "catalog", label: `${filters.catalogMode === "in" ? "In" : "Not in"} ${catalogName(filters.catalog)}` });
  if (filters.missingSlot) chips.push({ key: "missingSlot", label: `Missing translation: ${slotLabel(filters.missingSlot)}` });
  if (filters.emptyMetafield) chips.push({ key: "emptyMetafield", label: `Empty: ${defName(filters.emptyMetafield)}` });

  return (
    <>
      <FilterBar
        search={filters.search}
        onSearch={(search) => set({ search })}
        placeholder="Search title, handle, vendor, type or tag"
        activeCount={activeFilterCount(filters)}
        chips={chips}
        onRemoveChip={(key) => set({ [key]: "" } as Partial<BulkFilters>)}
        onClear={() => bulk.setFilters(NO_BULK_FILTERS)}
      >
        <SelectField label="Status" value={filters.status} options={[{ value: ANY, label: "Any" }, ...options.statuses.map((s) => ({ value: s, label: STATUS_LABEL[s] ?? s }))]} onChange={(status) => set({ status })} />
        <SelectField label="Vendor" value={filters.vendor} options={[{ value: ANY, label: "Any" }, ...options.vendors.map((v) => ({ value: v, label: v }))]} onChange={(vendor) => set({ vendor })} />
        <SelectField label="Product type" value={filters.productType} options={[{ value: ANY, label: "Any" }, ...options.types.map((v) => ({ value: v, label: v }))]} onChange={(productType) => set({ productType })} />
        <SelectField label="Tag" value={filters.tag} options={[{ value: ANY, label: "Any" }, ...options.tags.map((v) => ({ value: v, label: v }))]} onChange={(tag) => set({ tag })} />
        <SelectField
          label="Collection"
          value={filters.collection}
          options={[{ value: ANY, label: bulk.collections.status === "loading" ? "Reading collections…" : "Any" }, ...(bulk.collections.data ?? []).map((c) => ({ value: c.id, label: c.title }))]}
          onChange={(collection) => set({ collection })}
        />
        <SelectField label="Market catalogue" value={filters.catalog} options={[{ value: ANY, label: "Any" }, ...options.catalogs.map((c) => ({ value: c.id, label: c.title }))]} onChange={(catalog) => set({ catalog })} />
        {filters.catalog ? (
          <SelectField
            label="Products that are"
            value={filters.catalogMode}
            options={[
              { value: "in", label: "Published in it" },
              { value: "not", label: "Not published in it" },
            ]}
            onChange={(catalogMode) => set({ catalogMode: catalogMode === "not" ? "not" : "in" })}
          />
        ) : null}
        <SelectField label="Missing translation in" value={filters.missingSlot} options={[{ value: ANY, label: "Any" }, ...shared.slots.map((s) => ({ value: s.key, label: s.label }))]} onChange={(missingSlot) => set({ missingSlot })} />
        <SelectField label="Empty metafield" value={filters.emptyMetafield} options={[{ value: ANY, label: "Any" }, ...defs.map((d) => ({ value: `${d.namespace}.${d.key}`, label: `${d.name} (${d.namespace}.${d.key})` }))]} onChange={(emptyMetafield) => set({ emptyMetafield })} />
      </FilterBar>
      {bulk.collectionError ? <s-text tone="critical">{`The collection could not be read: ${bulk.collectionError}`}</s-text> : null}
    </>
  );
}
