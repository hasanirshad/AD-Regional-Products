// The simple tabs of the Edit product page: Basic data, SEO, Type and category, Tags, Prices, Inventory.
// (Metafield tabs are in MetafieldsTab.tsx.) Every field is a target; typing makes a pending edit, never a write.

import { useEffect, useMemo, useRef, useState } from "react";
import { categoryLabel, normText, rememberCategory, tagsFromValue, tagsToValue, dedupeTags, translationStatus } from "../../lib/editor/canon";
import type { ProductDoc } from "../../lib/editor/doc";
import { variantTitle } from "../../lib/editor/doc";
import { liveGql, messageOf } from "../../lib/editor/gql";
import { searchCategories, type CategoryChoice } from "../../lib/editor/load";
import { primaryLocale } from "../../lib/editor/locales";
import { PRODUCT_FIELD_LABEL, PRODUCT_TRANSLATION_KEY, STATUS_LABEL, targetKey, VARIANT_FIELD_LABEL, type ProductField, type Target, type VariantField } from "../../lib/editor/model";
import { onRemove } from "../../lib/dom";
import type { EditorShared } from "../../views/editor-state";
import type { EditState } from "../../views/edit-state";
import { Loading } from "../Loading";
import { SelectField } from "../SelectField";
import { FieldBlock, type LangCell } from "./FieldBlock";
import { RichTextEditor } from "./RichTextEditor";
import { TextBox } from "./TextBox";

export type TabProps = {
  edit: EditState;
  shared: EditorShared;
  doc: ProductDoc;
  /** In "Create product" the status stays draft until the last step. */
  statusLocked?: boolean;
  /** Tag suggestions from the products already in the store. */
  knownTags?: string[];
};

const productTarget = (productId: string, field: ProductField): Target => ({ kind: "product", productId, field });
const variantTarget = (productId: string, variantId: string, field: VariantField): Target => ({ kind: "variant", productId, variantId, field });

/** A product field with its translations in every store language. */
function TranslatableField({ edit, shared, doc, field, multiline, rows, hint, label, rich }: TabProps & { field: ProductField; multiline?: boolean; rows?: number; hint?: string; label?: string; rich?: boolean }) {
  const key = PRODUCT_TRANSLATION_KEY[field];
  const target = productTarget(doc.id, field);
  const source = edit.effectiveValue(target) ?? "";
  const savedSource = edit.baseValue(target) ?? "";
  const sourceEdited = normText(source) !== normText(savedSource);
  const primary = primaryLocale(shared.info.data?.locales ?? []);
  const name = label ?? PRODUCT_FIELD_LABEL[field];

  const cells: LangCell[] = key
    ? shared.slots.map((slot) => {
        const t: Target = { kind: "translation", productId: doc.id, resourceId: doc.id, resource: "product", field: key, slot: slot.key };
        const saved = doc.translations[doc.id]?.values[key]?.[slot.key];
        const value = edit.effectiveValue(t) ?? "";
        const isEdited = targetKey(t) in edit.edits;
        const outdated = (saved?.outdated ?? false) || (sourceEdited && !isEdited && normText(saved?.value) !== "");
        const canTranslate = normText(source) !== "";
        return {
          slot,
          value,
          status: translationStatus(source, value, outdated),
          changed: isEdited,
          editable: canTranslate,
          note: canTranslate ? undefined : "Add the source text first.",
          onChange: (text: string) => edit.put(t, text === "" ? null : text),
        };
      })
    : [];

  return (
    <FieldBlock
      label={name}
      hint={hint}
      primaryName={primary?.name ?? "Primary language"}
      sourceText={source}
      multiline={multiline}
      rows={rows}
      rich={rich}
      changed={targetKey(target) in edit.edits}
      cells={cells}
      source={
        rich ? (
          <RichTextEditor label={name} value={source} onChange={(text) => edit.put(target, text)} />
        ) : (
          <TextBox label={name} hideLabel value={source} multiline={multiline} rows={rows} onChange={(text) => edit.put(target, text)} />
        )
      }
    />
  );
}

export function BasicTab(props: TabProps) {
  const { edit, doc, statusLocked } = props;
  const status = edit.effectiveValue(productTarget(doc.id, "status")) ?? doc.status;
  return (
    <s-stack gap="base">
      <TranslatableField {...props} field="title" />
      <TranslatableField {...props} field="descriptionHtml" label="Description" rich hint="Format the text with the toolbar. Use HTML to see or edit the code. Copy the source into a language, then translate it in place." />
      <s-section heading="Vendor and status">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
          <TextBox label="Vendor" value={edit.effectiveValue(productTarget(doc.id, "vendor")) ?? ""} onChange={(text) => edit.put(productTarget(doc.id, "vendor"), text)} />
          <div>
            <SelectField
              label="Status"
              value={status}
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))}
              onChange={(v) => edit.put(productTarget(doc.id, "status"), v)}
            />
            {statusLocked ? <s-text color="subdued">The product stays a draft until the last step.</s-text> : null}
            {status === "ARCHIVED" || status === "DRAFT" ? <s-text color="subdued">A draft or archived product is not sold.</s-text> : null}
          </div>
        </div>
      </s-section>
    </s-stack>
  );
}

export function SeoTab(props: TabProps) {
  const { edit, doc } = props;
  const title = edit.effectiveValue(productTarget(doc.id, "seoTitle")) ?? "";
  const description = edit.effectiveValue(productTarget(doc.id, "seoDescription")) ?? "";
  return (
    <s-stack gap="base">
      <TranslatableField {...props} field="seoTitle" hint={`${title.length} characters. Search engines show about 60 to 70.`} />
      <TranslatableField {...props} field="seoDescription" multiline rows={3} hint={`${description.length} characters. Search engines show about 150 to 160.`} />
      <TranslatableField
        {...props}
        field="handle"
        label="URL handle"
        hint="The end of the product address. Changing it makes the old address redirect to the new one (you can turn that off in the review)."
      />
    </s-stack>
  );
}

export function TypeTab(props: TabProps) {
  const { edit, doc } = props;
  const target = productTarget(doc.id, "category");
  const current = edit.effectiveValue(target);
  const [text, setText] = useState("");
  const [found, setFound] = useState<CategoryChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      searchCategories(liveGql, q)
        .then((list) => id === seq.current && (setFound(list), setErr("")))
        .catch((e) => id === seq.current && setErr(messageOf(e)))
        .finally(() => id === seq.current && setBusy(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <s-stack gap="base">
      <TranslatableField {...props} field="productType" label="Product type" hint="Your own label for the kind of product, for example Dining table." />
      <s-section heading="Category">
        <s-stack gap="base">
          <s-text>{current ? categoryLabel(current) : "No category"}</s-text>
          <TextBox label="Search categories" value={text} onChange={setText} placeholder="For example dining tables" />
          {busy ? <Loading message="Searching…" /> : null}
          {err ? <s-text tone="critical">{err}</s-text> : null}
          {found.length > 0 ? (
            <s-stack gap="small-200">
              {found.map((c) => (
                <s-stack key={c.id} direction="inline" gap="small-200" alignItems="center">
                  <s-text>{c.fullName}</s-text>
                  {c.isLeaf ? (
                    <s-button
                      onClick={() => {
                        rememberCategory(c.id, c.fullName);
                        edit.put(target, c.id);
                        setText("");
                        setFound([]);
                      }}
                    >
                      Use
                    </s-button>
                  ) : (
                    <s-text color="subdued">Choose a more specific one</s-text>
                  )}
                </s-stack>
              ))}
            </s-stack>
          ) : null}
          {current ? (
            <div>
              <s-button variant="tertiary" onClick={() => edit.put(target, null)}>
                Remove the category
              </s-button>
            </div>
          ) : null}
        </s-stack>
      </s-section>
    </s-stack>
  );
}

export function TagsTab({ edit, doc, knownTags = [] }: TabProps) {
  const target = productTarget(doc.id, "tags");
  const tags = tagsFromValue(edit.effectiveValue(target));
  const saved = tagsFromValue(edit.baseValue(target));
  const [text, setText] = useState("");
  const set = (next: string[]) => edit.put(target, tagsToValue(dedupeTags(next)));
  const add = (raw: string) => {
    const parts = raw.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    if (parts.length) set([...tags, ...parts]);
    setText("");
  };
  const lower = new Set(tags.map((t) => t.toLowerCase()));
  const suggestions = useMemo(() => knownTags.filter((t) => !lower.has(t.toLowerCase())).slice(0, 24), [knownTags, tags.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <s-section heading="Tags">
      <s-stack gap="base">
        <s-text color="subdued">Tags are not translated. Shopify treats Sofa and sofa as one tag.</s-text>
        <s-stack direction="inline" gap="small-200">
          {tags.length === 0 ? <s-text color="subdued">No tags.</s-text> : null}
          {tags.map((t) => (
            <s-clickable-chip key={t} removable ref={onRemove(() => set(tags.filter((x) => x !== t)))}>
              {saved.some((s) => s.toLowerCase() === t.toLowerCase()) ? t : `${t} (new)`}
            </s-clickable-chip>
          ))}
        </s-stack>
        <s-stack direction="inline" gap="small-200" alignItems="end">
          <TextBox label="Add tags" value={text} onChange={setText} placeholder="oak, sale, new" details="Separate tags with commas." />
          <s-button disabled={text.trim() === "" || undefined} onClick={() => add(text)}>
            Add
          </s-button>
        </s-stack>
        {suggestions.length > 0 ? (
          <s-stack gap="small-200">
            <s-text color="subdued">Tags used in the store</s-text>
            <s-stack direction="inline" gap="small-200">
              {suggestions.map((t) => (
                <s-clickable-chip key={t} onClick={() => add(t)}>
                  {t}
                </s-clickable-chip>
              ))}
            </s-stack>
          </s-stack>
        ) : null}
      </s-stack>
    </s-section>
  );
}

export function PricesTab({ edit, shared, doc }: TabProps) {
  const currency = shared.info.data?.currency ?? "";
  return (
    <s-section heading="Prices">
      <s-stack gap="base">
        <s-text color="subdued">{`These are the prices of your primary market${currency ? ` (${currency})` : ""}. Prices for other markets are set in Shopify Markets. Leave the compare-at price empty for no sale price.`}</s-text>
        {doc.variantsTruncated ? <s-banner tone="warning">This product has more variants than were read. Only the first ones are shown.</s-banner> : null}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) minmax(120px, 1fr) minmax(120px, 1fr)", gap: 12, alignItems: "start" }}>
          <s-text type="strong">Variant</s-text>
          <s-text type="strong">Price</s-text>
          <s-text type="strong">Compare-at price</s-text>
          {doc.variants.map((v) => {
            const price = variantTarget(doc.id, v.id, "price");
            const compare = variantTarget(doc.id, v.id, "compareAtPrice");
            const problem = (t: Target) => edit.built.errors.find((e) => e.id === targetKey(t))?.message ?? null;
            return (
              <FragmentRow key={v.id}>
                <div style={{ paddingTop: 8 }}>
                  <s-text>{variantTitle(v)}</s-text>
                </div>
                <TextBox label={`Price of ${variantTitle(v)}`} hideLabel value={edit.effectiveValue(price) ?? ""} onChange={(text) => edit.put(price, text)} error={problem(price) ? "Enter a price, for example 49.90" : null} />
                <TextBox label={`Compare-at price of ${variantTitle(v)}`} hideLabel value={edit.effectiveValue(compare) ?? ""} onChange={(text) => edit.put(compare, text === "" ? null : text)} error={problem(compare) ? "Enter a price or leave it empty" : null} />
              </FragmentRow>
            );
          })}
        </div>
      </s-stack>
    </s-section>
  );
}

export function InventoryTab({ edit, shared, doc }: TabProps) {
  const locations = shared.info.data?.locations ?? [];
  return (
    <s-stack gap="base">
      {doc.variantsTruncated ? <s-banner tone="warning">This product has more variants than were read. Only the first ones are shown.</s-banner> : null}
      {doc.variants.map((v) => {
        const sku = variantTarget(doc.id, v.id, "sku");
        const barcode = variantTarget(doc.id, v.id, "barcode");
        const tracked = variantTarget(doc.id, v.id, "tracked");
        const policy = variantTarget(doc.id, v.id, "policy");
        const isTracked = (edit.effectiveValue(tracked) ?? "false") === "true";
        return (
          <s-section key={v.id} heading={variantTitle(v)}>
            <s-stack gap="base">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, alignItems: "start" }}>
                <TextBox label={VARIANT_FIELD_LABEL.sku} value={edit.effectiveValue(sku) ?? ""} onChange={(text) => edit.put(sku, text === "" ? null : text)} />
                <TextBox label={VARIANT_FIELD_LABEL.barcode} value={edit.effectiveValue(barcode) ?? ""} onChange={(text) => edit.put(barcode, text === "" ? null : text)} />
                <SelectField
                  label="Track quantity"
                  value={isTracked ? "true" : "false"}
                  options={[
                    { value: "true", label: "Yes" },
                    { value: "false", label: "No" },
                  ]}
                  onChange={(value) => edit.put(tracked, value)}
                />
                <SelectField
                  label="When sold out"
                  value={edit.effectiveValue(policy) ?? "DENY"}
                  options={[
                    { value: "DENY", label: "Stop selling" },
                    { value: "CONTINUE", label: "Keep selling" },
                  ]}
                  onChange={(value) => edit.put(policy, value)}
                />
              </div>
              {v.levels.length === 0 ? (
                <s-text color="subdued">This variant is not stocked at any location. Stock it in Shopify to set a quantity here.</s-text>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, alignItems: "start" }}>
                  {v.levels.map((l) => {
                    const t: Target = { kind: "stock", productId: doc.id, variantId: v.id, itemId: v.itemId, locationId: l.locationId };
                    const name = locations.find((x) => x.id === l.locationId)?.name ?? "Location";
                    const problem = edit.built.errors.find((e) => e.id === targetKey(t));
                    return <TextBox key={l.locationId} label={`Available at ${name}`} value={edit.effectiveValue(t) ?? ""} onChange={(text) => edit.put(t, text)} error={problem ? "Enter a whole number, 0 or more" : null} details={isTracked ? undefined : "Not tracked: the number is kept, but sales do not use it."} />;
                  })}
                </div>
              )}
            </s-stack>
          </s-section>
        );
      })}
    </s-stack>
  );
}

/** Children of a grid row, without a wrapper box. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
