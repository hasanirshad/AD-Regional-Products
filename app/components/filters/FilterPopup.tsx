import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { onChecked, onInput } from "../../lib/dom";
import { addValue, ANY, isWhole, NONE, SECTION_LABEL, SECTION_ORDER, STATUS_LABEL, type Availability, type FilterNames, type FilterState, type Match, type MetafieldState, type PageSection, type SectionId, type TranslationMode, type Tracking } from "../../lib/filters/filterModel";
import { SelectField } from "../SelectField";

export type PickOption = { value: string; label: string; count?: number };

/** The choices the popup offers. A page fills in only what its sections need. */
export type FilterOptions = {
  vendor?: PickOption[];
  productType?: PickOption[];
  tag?: PickOption[];
  catalog?: PickOption[];
  collection?: PickOption[];
  /** The collection list is read the first time the popup opens. */
  collectionState?: "idle" | "loading" | "ready" | "error";
  collectionError?: string;
  market?: PickOption[];
  locations?: PickOption[];
  /** Languages (translation slots). */
  slots?: PickOption[];
  /** Product metafield definitions: value "namespace.key". */
  metafields?: PickOption[];
  /** Filters only this page has, shown in "This page only". */
  pageSections?: PageSection[];
  /** A line under the Stock section ("Reading stock: 3 of 10 products…"). */
  stockNote?: string;
  /** A line under the Translations and Metafield sections (values are read in the background). */
  valuesNote?: string;
};

export type PopupConfig = { translationModes?: TranslationMode[] };

const toMap = (list: PickOption[] | undefined): Record<string, string> => Object.fromEntries((list ?? []).map((o) => [o.value, o.label]));

/** Names of ids for the chips, taken from the options. */
export function popupNames(o: FilterOptions): FilterNames {
  return { catalogs: toMap(o.catalog), collections: toMap(o.collection), markets: toMap(o.market), locations: toMap(o.locations), slots: toMap(o.slots), metafields: toMap(o.metafields), pageSections: o.pageSections };
}

const STATUS_OPTIONS = ["ACTIVE", "DRAFT", "ARCHIVED"].map((v) => ({ value: v, label: STATUS_LABEL[v]! }));
const AVAILABILITY: { value: Availability; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "soldout", label: "Sold out" },
];
const TRACKING: { value: Tracking; label: string }[] = [
  { value: "all", label: "Tracked" },
  { value: "none", label: "Not tracked" },
];
const MODE_LABEL: Record<Exclude<TranslationMode, "">, string> = { missing: "Missing a translation", outdated: "Outdated", complete: "Fully translated" };
const ALL_MODES: TranslationMode[] = ["missing", "outdated", "complete"];

/**
 * The Filters button and the popup (`s-modal`) with every filter of the page. The actions sit in the footer slots:
 * the primary "Apply filters" and the secondary "Clear all". It is closed whenever the page loads; the choices are a draft
 * until "Apply filters" (closing it another way drops the draft).
 */
export function FilterPopup({
  filters,
  active,
  onApply,
  onClear,
  onOpen,
  sections,
  options,
  pageTitle,
  translationModes,
}: {
  filters: FilterState;
  active: number;
  onApply: (f: FilterState) => void;
  onClear: () => void;
  onOpen?: () => void;
  sections: SectionId[];
  options: FilterOptions;
  pageTitle?: string;
  translationModes?: TranslationMode[];
}) {
  const id = `filters-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const latest = useRef(filters);
  latest.current = filters;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  // The popup tells us when it closes (Escape, the close button, the footer buttons).
  const modalRef = useCallback((el: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const closed = () => setOpen(false);
    el.addEventListener("hide", closed);
    el.addEventListener("afterhide", closed);
    cleanup.current = () => {
      el.removeEventListener("hide", closed);
      el.removeEventListener("afterhide", closed);
    };
  }, []);

  const show = () => {
    setDraft(latest.current);
    setOpen(true);
    onOpen?.();
  };
  const apply = () => {
    setOpen(false);
    onApply(draftRef.current);
  };
  const clear = () => {
    setOpen(false);
    onClear();
  };

  const shown = useMemo(() => SECTION_ORDER.filter((s) => sections.includes(s) && s !== "price"), [sections]);
  const set = useCallback((patch: Partial<FilterState>) => setDraft((d) => ({ ...d, ...patch })), []);

  return (
    <>
      <s-button icon="filter" commandFor={id} command="--show" onClick={show}>
        {active > 0 ? `Filters (${active})` : "Filters"}
      </s-button>
      <s-modal id={id} heading="Filters" size="large" ref={modalRef}>
        {open ? (
          <FilterSections sections={shown} draft={draft} set={set} options={options} pageTitle={pageTitle} translationModes={translationModes ?? ALL_MODES} />
        ) : null}
        <s-button slot="secondary-actions" commandFor={id} command="--hide" onClick={clear}>
          Clear all
        </s-button>
        <s-button slot="primary-action" variant="primary" commandFor={id} command="--hide" onClick={apply}>
          Apply filters
        </s-button>
      </s-modal>
    </>
  );
}

/** Every section of the popup, in the standard order (`sections` must already be in that order). */
export function FilterSections({ sections, draft, set, options, pageTitle, translationModes }: { sections: SectionId[]; draft: FilterState; set: (p: Partial<FilterState>) => void; options: FilterOptions; pageTitle?: string; translationModes: TranslationMode[] }) {
  return (
    <s-stack gap="large-100">
      <s-text color="subdued">A product must match every section you fill in. With several values in one section it needs any of them. The two tag sections can be used together.</s-text>
      {sections.map((s) => (
        <Section key={s} id={s} draft={draft} set={set} options={options} pageTitle={pageTitle} translationModes={translationModes} />
      ))}
    </s-stack>
  );
}

function Section({ id, draft, set, options, pageTitle, translationModes }: { id: SectionId; draft: FilterState; set: (p: Partial<FilterState>) => void; options: FilterOptions; pageTitle?: string; translationModes: TranslationMode[] }) {
  const heading = id === "page" ? (pageTitle ? `${SECTION_LABEL.page} (${pageTitle})` : SECTION_LABEL.page) : SECTION_LABEL[id];
  return (
    <s-stack gap="small-200">
      <s-heading>{heading}</s-heading>
      <SectionBody id={id} draft={draft} set={set} options={options} translationModes={translationModes} />
    </s-stack>
  );
}

function SectionBody({ id, draft, set, options, translationModes }: { id: SectionId; draft: FilterState; set: (p: Partial<FilterState>) => void; options: FilterOptions; translationModes: TranslationMode[] }) {
  switch (id) {
    case "status":
      return <Ticks options={STATUS_OPTIONS} selected={draft.status} onChange={(status) => set({ status })} />;
    case "vendor":
      return <MultiPicker label="Vendor" placeholder="Type a vendor…" options={options.vendor ?? []} selected={draft.vendor} onChange={(vendor) => set({ vendor })} />;
    case "productType":
      return <MultiPicker label="Product type" placeholder="Type a product type…" options={options.productType ?? []} selected={draft.productType} onChange={(productType) => set({ productType })} />;
    case "collection":
      return (
        <s-stack gap="small-200">
          {options.collectionState === "error" ? <s-text tone="critical">{options.collectionError || "Could not read the collections."}</s-text> : null}
          {options.collectionState === "loading" ? <s-text color="subdued">Reading the collections…</s-text> : null}
          <MultiPicker label="Collection" placeholder="Type a collection…" options={options.collection ?? []} selected={draft.collection} onChange={(collection) => set({ collection })} names={toMap(options.collection)} />
          {draft.collection.length > 0 ? <s-text color="subdued">The products of a collection are read in the background; the list fills as it goes.</s-text> : null}
        </s-stack>
      );
    case "tag":
      return (
        <s-stack gap="small-200">
          <TagDropdown label="Tag, has" options={options.tag ?? []} selected={draft.tag} onChange={(tag) => set({ tag })} />
          {draft.tag.length > 1 ? (
            <SelectField
              label="A product needs"
              value={draft.tagMatch}
              onChange={(v) => set({ tagMatch: (v === "all" ? "all" : "any") as Match })}
              options={[
                { value: "any", label: "Any of the chosen" },
                { value: "all", label: "All of the chosen" },
              ]}
            />
          ) : null}
        </s-stack>
      );
    case "tagNot":
      return (
        <s-stack gap="small-200">
          <TagDropdown label="Tag, does not have" options={options.tag ?? []} selected={draft.tagNot} onChange={(tagNot) => set({ tagNot })} />
          <s-text color="subdued">A product is kept only if it has none of these tags.</s-text>
        </s-stack>
      );
    case "catalog":
      return (
        <s-stack gap="base">
          <MultiPicker
            label="In these catalogues"
            placeholder="Type a catalogue…"
            options={[{ value: NONE, label: "In no catalogue" }, { value: ANY, label: "In any catalogue" }, ...(options.catalog ?? [])]}
            selected={draft.catalogIn}
            onChange={(catalogIn) => set({ catalogIn })}
            names={toMap(options.catalog)}
          />
          <MultiPicker label="Not in these catalogues" placeholder="Type a catalogue…" options={options.catalog ?? []} selected={draft.catalogNot} onChange={(catalogNot) => set({ catalogNot })} names={toMap(options.catalog)} />
        </s-stack>
      );
    case "market":
      return <Ticks options={options.market ?? []} selected={draft.market} onChange={(market) => set({ market })} />;
    case "stock":
      return (
        <s-stack gap="base">
          <s-stack gap="small-100">
            <s-text type="strong">Availability</s-text>
            <Ticks options={AVAILABILITY} selected={draft.availability} onChange={(availability) => set({ availability: availability as Availability[] })} />
          </s-stack>
          <s-stack gap="small-100">
            <s-text type="strong">Tracked</s-text>
            <Ticks options={TRACKING} selected={draft.tracked} onChange={(tracked) => set({ tracked: tracked as Tracking[] })} />
          </s-stack>
          <MultiPicker
            label="Stocked at"
            placeholder="Type a location…"
            options={[...(options.locations ?? []), { value: NONE, label: "Stocked nowhere" }]}
            selected={draft.locations}
            onChange={(locations) => set({ locations })}
            names={toMap(options.locations)}
          />
          <s-text color="subdued">{options.stockNote || "Stock is read from Shopify in the background; the list fills as it goes."}</s-text>
        </s-stack>
      );
    case "variants":
      return <VariantRange min={draft.min} max={draft.max} onChange={(min, max) => set({ min, max })} />;
    case "price":
      return null;
    case "translations":
      return (
        <s-stack gap="small-200">
          <SelectField
            label="Show products that are"
            value={draft.translationMode}
            onChange={(v) => set({ translationMode: (translationModes.includes(v as TranslationMode) ? v : "") as TranslationMode })}
            options={[{ value: "", label: "Any" }, ...translationModes.map((m) => ({ value: m, label: MODE_LABEL[m as Exclude<TranslationMode, "">] }))]}
          />
          {draft.translationMode ? (
            <s-stack gap="small-100">
              <s-text type="strong">In these languages (none ticked: every language)</s-text>
              <Ticks options={options.slots ?? []} selected={draft.translationSlots} onChange={(translationSlots) => set({ translationSlots })} />
            </s-stack>
          ) : null}
          <s-text color="subdued">{options.valuesNote || "Translations are read in the background; the list fills as it goes."}</s-text>
        </s-stack>
      );
    case "metafield":
      return (
        <s-stack gap="small-200">
          <SelectField label="Metafield" value={draft.metafield} onChange={(metafield) => set({ metafield, metafieldState: metafield ? draft.metafieldState || "empty" : "" })} options={[{ value: "", label: "Any" }, ...(options.metafields ?? []).map((o) => ({ value: o.value, label: o.label }))]} />
          {draft.metafield ? (
            <SelectField
              label="The metafield is"
              value={draft.metafieldState || "empty"}
              onChange={(v) => set({ metafieldState: (v === "filled" ? "filled" : "empty") as MetafieldState })}
              options={[
                { value: "empty", label: "Empty" },
                { value: "filled", label: "Not empty" },
              ]}
            />
          ) : null}
          <s-text color="subdued">{options.valuesNote || "Values are read in the background; the list fills as it goes."}</s-text>
        </s-stack>
      );
    case "page":
      return (
        <s-stack gap="base">
          {(options.pageSections ?? []).map((p) => (
            <s-stack key={p.key} gap="small-100">
              <s-text type="strong">{p.label}</s-text>
              {p.single ? (
                <SelectField
                  label={p.label}
                  hideLabel
                  value={draft.page[p.key]?.[0] ?? ""}
                  onChange={(v) => set({ page: setPage(draft.page, p.key, v ? [v] : []) })}
                  options={[{ value: "", label: "Any" }, ...p.options]}
                />
              ) : (
                <Ticks options={p.options} selected={draft.page[p.key] ?? []} onChange={(values) => set({ page: setPage(draft.page, p.key, values) })} />
              )}
            </s-stack>
          ))}
        </s-stack>
      );
  }
}

function setPage(page: Record<string, string[]>, key: string, values: string[]): Record<string, string[]> {
  const next = { ...page };
  if (values.length === 0) delete next[key];
  else next[key] = values;
  return next;
}

// A type-and-pick box for lists with many values. Typing narrows the list; "Browse all" shows it without typing.
function MultiPicker({ label, placeholder, options, selected, onChange, names }: { label: string; placeholder: string; options: PickOption[]; selected: string[]; onChange: (values: string[]) => void; names?: Record<string, string> }) {
  const [text, setText] = useState("");
  const [browse, setBrowse] = useState(false);
  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    const left = options.filter((o) => !selected.includes(o.value));
    return (q ? left.filter((o) => o.label.toLowerCase().includes(q)) : left).slice(0, 60);
  }, [options, selected, q]);
  const show = q !== "" || browse;
  const pick = (value: string) => {
    onChange(addValue(selected, value));
    setText("");
  };
  const nameOf = (v: string) => (v === NONE ? "None" : v === ANY ? "Any" : (names?.[v] ?? v));
  return (
    <s-stack gap="small-200">
      <s-text-field label={selected.length ? `${label} (${selected.length})` : label} placeholder={placeholder} value={text} ref={onInput(setText)} />
      {selected.length > 0 ? (
        <s-stack direction="inline" gap="small-200">
          {selected.map((v) => (
            <s-button key={v} variant="tertiary" accessibilityLabel={`Remove ${nameOf(v)}`} onClick={() => onChange(selected.filter((x) => x !== v))}>
              {`${options.find((o) => o.value === v)?.label ?? nameOf(v)} ✕`}
            </s-button>
          ))}
        </s-stack>
      ) : null}
      <div>
        <s-button variant="tertiary" onClick={() => setBrowse((b) => !b)}>
          {browse ? "Hide the list" : `Browse all (${options.length})`}
        </s-button>
      </div>
      {show ? (
        <s-box border="base" borderRadius="base" padding="small-200">
          <div style={{ maxHeight: 200, overflowY: "auto" }}>
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
        </s-box>
      ) : null}
    </s-stack>
  );
}

// Tags as a plain dropdown: pick one, it is added; pick another to add more. The chosen tags are listed with a remove button.
function TagDropdown({ label, options, selected, onChange }: { label: string; options: PickOption[]; selected: string[]; onChange: (values: string[]) => void }) {
  const left = options.filter((o) => !selected.includes(o.value));
  return (
    <s-stack gap="small-200">
      {/* The key makes the dropdown start again at "Add a tag…" after each pick. */}
      <SelectField
        key={selected.length}
        label={selected.length ? `${label} (${selected.length})` : label}
        value=""
        onChange={(v) => v && onChange(addValue(selected, v))}
        options={[{ value: "", label: left.length ? "Add a tag…" : "No more tags" }, ...left.map((o) => ({ value: o.value, label: o.count !== undefined ? `${o.label} (${o.count})` : o.label }))]}
      />
      {selected.length > 0 ? (
        <s-stack direction="inline" gap="small-200">
          {selected.map((v) => (
            <s-button key={v} variant="tertiary" accessibilityLabel={`Remove ${v}`} onClick={() => onChange(selected.filter((x) => x !== v))}>
              {`${v} ✕`}
            </s-button>
          ))}
        </s-stack>
      ) : null}
    </s-stack>
  );
}

// A few fixed choices as tick boxes (any of the ticked ones).
function Ticks({ options, selected, onChange }: { options: { value: string; label: string }[]; selected: string[]; onChange: (values: string[]) => void }) {
  if (options.length === 0) return <s-text color="subdued">Nothing to choose from yet.</s-text>;
  return (
    <s-stack direction="inline" gap="base">
      {options.map((o) => (
        <s-checkbox key={o.value} label={o.label} checked={selected.includes(o.value) || undefined} ref={onChecked((on) => onChange(on ? addValue(selected, o.value) : selected.filter((x) => x !== o.value)))} />
      ))}
    </s-stack>
  );
}

function VariantRange({ min, max, onChange }: { min: string; max: string; onChange: (min: string, max: string) => void }) {
  return (
    <s-stack direction="inline" gap="base">
      <s-text-field label="At least" value={min} error={isWhole(min) ? undefined : "Whole number"} ref={onInput((v) => onChange(v, max))} />
      <s-text-field label="At most" value={max} error={isWhole(max) ? undefined : "Whole number"} ref={onInput((v) => onChange(min, v))} />
    </s-stack>
  );
}
