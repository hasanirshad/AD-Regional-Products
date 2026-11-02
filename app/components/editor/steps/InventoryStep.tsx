// Step 3, Inventory & prices. One tile per variant, titled like its options ("Oak / 180 cm"): SKU, the CAP (compare-at
// price) the person types, the sale price that follows it (read only), and where the variant is stocked.
//   made to order: inventory is not tracked; each variant sits at the default location (Hardman Möbel Ltd. | London) with no quantity
//   in stock:      inventory is tracked, a quantity of 1 for each variant
// Switching between the two here changes every variant, and each variant can still be changed by hand afterwards.

import { useEffect, useMemo, useState } from "react";
import { capValue, defaultLocation, planCap, planCapForAll, planStockMode, stockTargetOf, trackedTarget } from "../../../lib/editor/inventoryPlan";
import { normText } from "../../../lib/editor/canon";
import { variantTitle, type ProductDoc, type VariantDoc } from "../../../lib/editor/doc";
import { targetKey } from "../../../lib/editor/model";
import type { EditState } from "../../../views/edit-state";
import type { EditorShared } from "../../../views/editor-state";
import { SelectField } from "../../SelectField";
import { variantTarget } from "../EditTabs";
import { TextBox } from "../TextBox";
import { StepHeading } from "./StepStrip";
import { StockKindToggle, stockKindOf } from "./StockKindToggle";

type Location = { id: string; name: string };

/** The locations a variant is stocked at on screen: the saved ones, then the ones just added; a removed one is listed apart. */
function placesOf(edit: EditState, doc: ProductDoc, v: VariantDoc): { stocked: string[]; removed: string[] } {
  const saved = v.levels.map((l) => l.locationId);
  const added: string[] = [];
  const removed: string[] = [];
  for (const e of Object.values(edit.edits)) {
    const t = e.target;
    if (t.kind !== "stock" || t.variantId !== v.id) continue;
    if (e.value === null) {
      if (saved.includes(t.locationId)) removed.push(t.locationId);
    } else if (!saved.includes(t.locationId)) added.push(t.locationId);
  }
  return { stocked: [...saved.filter((id) => !removed.includes(id)), ...added], removed };
}

export function InventoryStep({ edit, shared, doc }: { edit: EditState; shared: EditorShared; doc: ProductDoc }) {
  const locations: Location[] = shared.info.data?.locations ?? [];
  const currency = shared.info.data?.currency ?? "";
  const where = defaultLocation(locations);
  const kind = stockKindOf(edit, doc);
  const [capText, setCapText] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [bulkCap, setBulkCap] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});

  // A draft made here starts with its variants stocked the way the product is sold. Existing products are never changed on their own.
  const needing = useMemo(
    () =>
      edit.entry !== "create" || doc.status !== "DRAFT"
        ? []
        : doc.variants.filter((v) => v.levels.length === 0 && !Object.keys(edit.edits).some((k) => k.startsWith(`s|${v.id}|`) || k === `v|${v.id}|tracked`)),
    [edit.entry, doc.status, doc.variants, edit.edits],
  );
  useEffect(() => {
    if (needing.length === 0 || !shared.info.data) return;
    const plan = planStockMode(doc.id, needing, kind, where?.id ?? null);
    for (const e of plan.edits) edit.put(e.target, e.value);
  }, [needing.map((v) => v.id).join("|"), shared.info.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: string) => locations.find((l) => l.id === id)?.name ?? "Location";
  const problem = (t: ReturnType<typeof stockTargetOf>) => edit.built.errors.find((e) => e.id === targetKey(t));

  const putPlanned = (edits: { target: Parameters<EditState["put"]>[0]; value: string | null }[]) => {
    for (const e of edits) edit.put(e.target, e.value);
  };

  const copyCap = () => {
    const plan = planCapForAll(doc.id, doc.variants, bulkCap);
    if (plan.bad) {
      setBulkNote("Enter a price, for example 1990.00.");
      return;
    }
    putPlanned(plan.edits);
    setCapText(Object.fromEntries(doc.variants.map((v) => [v.id, bulkCap])));
    setBulkNote(plan.notes.length ? plan.notes[0]! : "");
  };

  const stockEverywhere = (locationId: string) => {
    const qty = kind === "stock" ? "1" : "0";
    for (const v of doc.variants) {
      const { stocked } = placesOf(edit, doc, v);
      if (stocked.includes(locationId)) continue;
      edit.put(stockTargetOf(doc.id, v, locationId), qty);
    }
  };

  return (
    <s-stack gap="base">
      <StepHeading step="inventory" />
      {doc.variantsTruncated ? <s-banner tone="warning">This product has more variants than were read. Only the first ones are shown.</s-banner> : null}

      <s-section heading="How is it sold?">
        <s-stack gap="small-200">
          <StockKindToggle edit={edit} shared={shared} doc={doc} applyNow />
          {!where ? <s-banner tone="warning">{`The location "Hardman Möbel Ltd. | London" was not found in this store. Choose a location for each variant below.`}</s-banner> : null}
        </s-stack>
      </s-section>

      <s-section heading="Prices">
        <s-stack gap="small-200">
          <s-text color="subdued">{`Type the CAP (the compare-at price)${currency ? ` in ${currency}` : ""}. The sale price is filled in from it and cannot be typed here. A sale that is already running is left as it is.`}</s-text>
          {doc.variants.length > 1 ? (
            <s-stack direction="inline" gap="small-200" alignItems="end">
              <TextBox label="Same CAP for every variant" value={bulkCap} placeholder="1990.00" onChange={(t) => { setBulkCap(t); setBulkNote(""); }} />
              <s-button onClick={copyCap} disabled={normText(bulkCap) === "" || undefined}>
                Use for all variants
              </s-button>
            </s-stack>
          ) : null}
          {bulkNote ? <s-text color="subdued">{bulkNote}</s-text> : null}
        </s-stack>
      </s-section>

      {locations.length > 1 && doc.variants.length > 1 ? (
        <s-section heading="Locations for all variants">
          <s-stack direction="inline" gap="small-200" alignItems="end">
            <SelectField
              label="Also stock every variant at"
              value={extra.__all ?? ""}
              options={[{ value: "", label: "Choose a location" }, ...locations.map((l) => ({ value: l.id, label: l.name }))]}
              onChange={(value) => setExtra((x) => ({ ...x, __all: value }))}
            />
            <s-button disabled={!extra.__all || undefined} onClick={() => { stockEverywhere(extra.__all!); setExtra((x) => ({ ...x, __all: "" })); }}>
              Add to all
            </s-button>
          </s-stack>
        </s-section>
      ) : null}

      {doc.variants.map((v) => {
        const title = variantTitle(v);
        const sku = variantTarget(doc.id, v.id, "sku");
        const compare = variantTarget(doc.id, v.id, "compareAtPrice");
        const price = variantTarget(doc.id, v.id, "price");
        const tracked = (edit.effectiveValue(trackedTarget(doc.id, v)) ?? "false") === "true";
        const shownCap = capText[v.id] ?? edit.effectiveValue(compare) ?? "";
        const cap = capValue(shownCap);
        const places = placesOf(edit, doc, v);
        const free = locations.filter((l) => !places.stocked.includes(l.id));
        const dupSku = normText(edit.effectiveValue(sku)) !== "" && doc.variants.some((o) => o.id !== v.id && normText(edit.effectiveValue(variantTarget(doc.id, o.id, "sku"))).toLowerCase() === normText(edit.effectiveValue(sku)).toLowerCase());
        return (
          <s-section key={v.id} heading={title}>
            <s-stack gap="base">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, alignItems: "start" }}>
                <TextBox label="SKU" value={edit.effectiveValue(sku) ?? ""} onChange={(t) => edit.put(sku, t === "" ? null : t)} error={dupSku ? "Another variant of this product has the same SKU." : null} />
                <TextBox
                  label="CAP (compare-at price)"
                  value={shownCap}
                  placeholder="1990.00"
                  error={cap.bad ? "Enter a price, for example 1990.00" : null}
                  onChange={(text) => {
                    setCapText((c) => ({ ...c, [v.id]: text }));
                    const plan = planCap(doc.id, v, text);
                    if (plan.bad) {
                      // What was typed stays on screen with the error; the last good value stays pending until the text is a price again.
                      return;
                    }
                    putPlanned(plan.edits);
                    setNotes((n) => ({ ...n, [v.id]: plan.note ?? "" }));
                  }}
                />
                <div>
                  <s-text type="strong">Sale price</s-text>
                  <div style={{ paddingTop: 6 }}>
                    <s-text>{`${edit.effectiveValue(price) ?? v.price}${currency ? ` ${currency}` : ""}`}</s-text>
                  </div>
                  <s-text color="subdued">{notes[v.id] || "Follows the CAP. Read only."}</s-text>
                </div>
              </div>

              <s-stack gap="small-200">
                <SelectField
                  label="Track quantity"
                  value={tracked ? "true" : "false"}
                  options={[
                    { value: "false", label: "No: made to order, always available" },
                    { value: "true", label: "Yes: stock, counted per location" },
                  ]}
                  onChange={(value) => edit.put(trackedTarget(doc.id, v), value)}
                />
                {places.stocked.length === 0 ? <s-text color="subdued">Not stocked at any location yet. Add one below.</s-text> : null}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, alignItems: "start" }}>
                  {places.stocked.map((id) => {
                    const t = stockTargetOf(doc.id, v, id);
                    return (
                      <s-stack key={id} gap="small-100">
                        <TextBox label={`Available at ${nameOf(id)}`} value={edit.effectiveValue(t) ?? ""} onChange={(text) => edit.put(t, text)} error={problem(t) ? "Enter a whole number, 0 or more" : null} details={tracked ? undefined : "Not tracked: the number is kept, but sales do not use it."} />
                        <div>
                          <s-button variant="tertiary" tone="critical" onClick={() => edit.put(t, null)}>
                            Remove this location
                          </s-button>
                        </div>
                      </s-stack>
                    );
                  })}
                </div>
                {places.removed.length > 0 ? (
                  <s-stack direction="inline" gap="small-200">
                    {places.removed.map((id) => (
                      <s-button key={id} variant="tertiary" onClick={() => edit.discard([targetKey(stockTargetOf(doc.id, v, id))])}>
                        {`Keep ${nameOf(id)}`}
                      </s-button>
                    ))}
                  </s-stack>
                ) : null}
                {free.length > 0 ? (
                  <s-stack direction="inline" gap="small-200" alignItems="end">
                    <SelectField label="Add a location" value={extra[v.id] ?? ""} options={[{ value: "", label: "Choose a location" }, ...free.map((l) => ({ value: l.id, label: l.name }))]} onChange={(value) => setExtra((x) => ({ ...x, [v.id]: value }))} />
                    <s-button
                      disabled={!extra[v.id] || undefined}
                      onClick={() => {
                        edit.put(stockTargetOf(doc.id, v, extra[v.id]!), tracked ? "1" : "0");
                        setExtra((x) => ({ ...x, [v.id]: "" }));
                      }}
                    >
                      Add
                    </s-button>
                  </s-stack>
                ) : null}
              </s-stack>
            </s-stack>
          </s-section>
        );
      })}
    </s-stack>
  );
}
