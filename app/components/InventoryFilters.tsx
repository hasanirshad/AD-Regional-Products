import { useMemo, useRef, useState } from "react";
import { onChecked, onInput, onRemove } from "../lib/dom";
import { NONE } from "../lib/filter";
import { activeInvChips, NO_INV_FILTERS, type Availability, type InvFilters, type Match, type Tracking } from "../lib/inventoryFilter";
import { SelectField } from "./SelectField";
import { useTypedSearch } from "./FilterBar";

export type PickOption = { value: string; label: string; count?: number };

export type InventoryFilterOptions = {
  status: PickOption[];
  vendor: PickOption[];
  productType: PickOption[];
  tag: PickOption[];
  catalog: PickOption[];
  /** The store's locations (for "stocked at"). */
  locations: PickOption[];
};

export type StockProgress = {
  /** A filter that needs stock is on. */
  needed: boolean;
  /** Products still to read (0 = done). */
  remaining: number;
  total: number;
};

const AVAILABILITY: { value: Availability; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "soldout", label: "Sold out" },
  { value: "partly", label: "Partly sold out" },
];
const TRACKING: { value: Tracking; label: string }[] = [
  { value: "all", label: "Tracked" },
  { value: "none", label: "Not tracked" },
  { value: "some", label: "Partly tracked" },
];

/**
 * The filters of the Inventory page: a search box, a button that opens a panel above the table, and one chip per chosen value.
 * Lists with many values (tags, vendors, ...) are type-and-pick, with several values allowed.
 */
export function InventoryFilters({
  filters,
  onChange,
  options,
  stock,
  shown,
  total,
}: {
  filters: InvFilters;
  onChange: (f: InvFilters) => void;
  options: InventoryFilterOptions;
  stock: StockProgress;
  shown: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  // The pause before a typed search is applied must not overwrite a filter chosen in the meantime.
  const latest = useRef(filters);
  latest.current = filters;
  const { text, type, reset } = useTypedSearch(filters.search, (search) => onChange({ ...latest.current, search }));
  const names = useMemo(
    () => ({
      catalogs: Object.fromEntries(options.catalog.map((o) => [o.value, o.label])),
      locations: Object.fromEntries(options.locations.map((o) => [o.value, o.label])),
    }),
    [options.catalog, options.locations],
  );
  const chips = activeInvChips(filters, names);
  const set = (patch: Partial<InvFilters>) => onChange({ ...filters, ...patch });

  return (
    <s-stack gap="base">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 8, alignItems: "center" }}>
        <s-search-field label="Search" labelAccessibilityVisibility="exclusive" placeholder="Search by title, handle, vendor, type or tag" value={text} ref={onInput(type)} />
        <s-button icon={open ? "chevron-up" : "chevron-down"} onClick={() => setOpen((o) => !o)}>
          {chips.length > 0 ? `Filters (${chips.length})` : "Filters"}
        </s-button>
        {chips.length > 0 || text ? (
          <s-button
            variant="tertiary"
            onClick={() => {
              reset();
              onChange(NO_INV_FILTERS);
            }}
          >
            Clear all
          </s-button>
        ) : (
          <span />
        )}
      </div>

      {chips.length > 0 ? (
        <s-stack direction="inline" gap="small-200">
          {chips.map((c) => (
            <s-clickable-chip key={c.key} removable ref={onRemove(() => onChange(c.remove(filters)))}>
              {c.label}
            </s-clickable-chip>
          ))}
        </s-stack>
      ) : null}

      {open ? (
        <s-box padding="base" border="base" borderRadius="base">
          <s-stack gap="base">
            <s-text color="subdued">Products must match every box you fill in (AND). With several values in one box, you choose whether a product needs any of them or all of them.</s-text>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
              <TagDropdown options={options.tag} selected={filters.tag} onChange={(tag) => set({ tag })} match={filters.tagMatch} onMatch={(tagMatch) => set({ tagMatch })} />
              <MultiPicker label="Vendor" placeholder="Type a vendor…" options={options.vendor} selected={filters.vendor} onChange={(vendor) => set({ vendor })} />
              <MultiPicker label="Product type" placeholder="Type a product type…" options={options.productType} selected={filters.productType} onChange={(productType) => set({ productType })} />
              <MultiPicker
                label="Catalogue"
                placeholder="Type a catalogue…"
                options={[{ value: NONE, label: "In no catalogue" }, ...options.catalog]}
                selected={filters.catalog}
                onChange={(catalog) => set({ catalog })}
                match={filters.catalogMatch}
                onMatch={(catalogMatch) => set({ catalogMatch })}
              />
              <ChoiceRow label="Status" options={options.status} selected={filters.status} onChange={(status) => set({ status })} />
              <VariantRange min={filters.min} max={filters.max} onChange={(min, max) => set({ min, max })} />
            </div>

            <s-divider />
            <s-text color="subdued">The filters below need the stock of each product. Shopify is read in the background; the list fills as it goes.</s-text>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, alignItems: "start" }}>
              <ChoiceRow label="Availability" options={AVAILABILITY} selected={filters.availability} onChange={(availability) => set({ availability: availability as Availability[] })} />
              <ChoiceRow label="Tracked" options={TRACKING} selected={filters.tracked} onChange={(tracked) => set({ tracked: tracked as Tracking[] })} />
              <MultiPicker
                label="Stocked at (location)"
                placeholder="Type a location…"
                options={[...options.locations, { value: NONE, label: "Stocked nowhere" }]}
                selected={filters.locations}
                onChange={(locations) => set({ locations })}
                match={filters.locationMatch}
                onMatch={(locationMatch) => set({ locationMatch })}
              />
            </div>
            {stock.needed ? (
              stock.remaining > 0 ? (
                <s-text color="subdued">{`Reading stock: ${stock.total - stock.remaining} of ${stock.total} products…`}</s-text>
              ) : (
                <s-text color="subdued">{`Stock read for all ${stock.total} products.`}</s-text>
              )
            ) : null}
          </s-stack>
        </s-box>
      ) : null}

      <s-text color="subdued">{`${shown} of ${total} products${stock.needed && stock.remaining > 0 ? " (still reading stock)" : ""}`}</s-text>
    </s-stack>
  );
}

// A type-and-pick box for lists with many values. Typing narrows the list; "Browse all" shows it without typing.
function MultiPicker({
  label,
  placeholder,
  options,
  selected,
  onChange,
  match,
  onMatch,
}: {
  label: string;
  placeholder: string;
  options: PickOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  match?: Match;
  onMatch?: (m: Match) => void;
}) {
  const [text, setText] = useState("");
  const [browse, setBrowse] = useState(false);
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    const left = options.filter((o) => !selected.includes(o.value));
    return (q ? left.filter((o) => o.label.toLowerCase().includes(q)) : left).slice(0, 60);
  }, [options, selected, q]);
  const show = q !== "" || browse;
  const pick = (value: string) => {
    onChange([...selected, value]);
    setText("");
  };
  return (
    <s-stack gap="small-200">
      <s-text-field label={selected.length ? `${label} (${selected.length})` : label} placeholder={placeholder} value={text} ref={onInput(setText)} />
      <div>
        <s-button variant="tertiary" onClick={() => setBrowse((b) => !b)}>
          {browse ? "Hide the list" : `Browse all (${options.length})`}
        </s-button>
      </div>
      {match && onMatch && selected.length > 1 ? <MatchSelect value={match} onChange={onMatch} /> : null}
      {show ? (
        <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--p-color-border, #d0d0d0)", borderRadius: 8, padding: 4 }}>
          {matches.length === 0 ? (
            <s-text color="subdued">{q ? "No match." : "Nothing left to pick."}</s-text>
          ) : (
            matches.map((o) => (
              <div key={o.value}>
                <s-button variant="tertiary" onClick={() => pick(o.value)}>
                  {o.count !== undefined ? `${o.label} (${o.count})` : o.label}
                </s-button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </s-stack>
  );
}

function MatchSelect({ value, onChange }: { value: Match; onChange: (m: Match) => void }) {
  return (
    <SelectField
      label="A product needs"
      value={value}
      onChange={(v) => onChange(v === "all" ? "all" : "any")}
      options={[
        { value: "any", label: "Any of the chosen" },
        { value: "all", label: "All of the chosen" },
      ]}
    />
  );
}

// Tags as a plain dropdown: pick one, it is added to the chosen tags, pick another to add more.
function TagDropdown({
  options,
  selected,
  onChange,
  match,
  onMatch,
}: {
  options: PickOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  match: Match;
  onMatch: (m: Match) => void;
}) {
  const left = options.filter((o) => !selected.includes(o.value));
  return (
    <s-stack gap="small-200">
      {/* The key makes the dropdown start again at "Add a tag…" after each pick. */}
      <SelectField
        key={selected.length}
        label={selected.length ? `Tag (${selected.length})` : "Tag"}
        value=""
        onChange={(v) => v && onChange([...selected, v])}
        options={[{ value: "", label: left.length ? "Add a tag…" : "No more tags" }, ...left.map((o) => ({ value: o.value, label: o.count !== undefined ? `${o.label} (${o.count})` : o.label }))]}
      />
      {selected.length > 1 ? <MatchSelect value={match} onChange={onMatch} /> : null}
    </s-stack>
  );
}

// A few fixed choices as tick boxes (any of the ticked ones).
function ChoiceRow({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <s-stack gap="small-200">
      <s-heading>{label}</s-heading>
      <s-stack direction="inline" gap="base">
        {options.map((o) => (
          <s-checkbox
            key={o.value}
            label={o.label}
            checked={selected.includes(o.value) || undefined}
            ref={onChecked((on) => onChange(on ? [...selected.filter((x) => x !== o.value), o.value] : selected.filter((x) => x !== o.value)))}
          />
        ))}
      </s-stack>
    </s-stack>
  );
}

function VariantRange({ min, max, onChange }: { min: string; max: string; onChange: (min: string, max: string) => void }) {
  const bad = (t: string) => t.trim() !== "" && !/^\d+$/.test(t.trim());
  return (
    <s-stack gap="small-200">
      <s-heading>Number of variants</s-heading>
      <s-stack direction="inline" gap="base">
        <s-text-field label="At least" value={min} error={bad(min) ? "Whole number" : undefined} ref={onInput((v) => onChange(v, max))} />
        <s-text-field label="At most" value={max} error={bad(max) ? "Whole number" : undefined} ref={onInput((v) => onChange(min, v))} />
      </s-stack>
    </s-stack>
  );
}
