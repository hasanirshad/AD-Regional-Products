// The Product metafields and Variant metafields tabs. Only the metafields chosen in this session are shown.
// "Choose metafields" lists every definition; ticking adds a row, one click removes it (it only hides the row: no value
// is cleared). A choice can be saved as a named set, stored inside Shopify. Each row has an input matched to its type.

import { useMemo, useState } from "react";
import { normText, translationStatus } from "../../lib/editor/canon";
import { mfKey, variantTitle, type ProductDoc } from "../../lib/editor/doc";
import { liveGql, messageOf } from "../../lib/editor/gql";
import { defKey, type Definition } from "../../lib/editor/load";
import { draftsFromStored, storedFromDrafts, supportOf, translatableMetafield, valueEditable } from "../../lib/editor/mfModel";
import { formatValue, inputKindOf, isListType, typeLabel, type Draft, type OwnerKind } from "../../lib/editor/mfTypes";
import { primaryLocale } from "../../lib/editor/locales";
import { newId, saveSets, type SavedSet } from "../../lib/editor/settings";
import { targetKey, type Target } from "../../lib/editor/model";
import { onChecked } from "../../lib/dom";
import type { EditorShared } from "../../views/editor-state";
import type { EditState } from "../../views/edit-state";
import { Loading } from "../Loading";
import { useGuard } from "../PasswordGate";
import { SelectField } from "../SelectField";
import { Dialog } from "./Dialog";
import { FieldBlock, type LangCell } from "./FieldBlock";
import { TextBox } from "./TextBox";
import { ValueEditor } from "./ValueEditor";

type Props = { edit: EditState; shared: EditorShared; doc: ProductDoc };
type RowDef = { namespace: string; key: string; name: string; type: string; validations: Definition["validations"]; description?: string };

/** Translations are offered for single text, multi-line text and links. The value must be saved first: the translation belongs to the saved metafield. */
const translatableHere = (type: string): boolean => translatableMetafield(type) && !isListType(type) && ["text", "multiline", "url"].includes(inputKindOf(type));

export function MetafieldChooser({ defs, chosen, onDone, onClose, heading }: { defs: Definition[]; chosen: string[]; onDone: (keys: string[]) => void; onClose: () => void; heading: string }) {
  const [picked, setPicked] = useState<string[]>(chosen);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const map = new Map<string, Definition[]>();
    for (const d of defs) {
      if (q && !`${d.name} ${d.namespace}.${d.key} ${d.type}`.toLowerCase().includes(q)) continue;
      const list = map.get(d.namespace);
      if (list) list.push(d);
      else map.set(d.namespace, [d]);
    }
    return [...map.entries()];
  }, [defs, q]);
  const toggle = (key: string, on: boolean) => setPicked((p) => (on ? (p.includes(key) ? p : [...p, key]) : p.filter((k) => k !== key)));

  return (
    <Dialog
      heading={heading}
      onClose={onClose}
      footer={
        <s-stack direction="inline" gap="small-200" justifyContent="end">
          <s-button onClick={onClose}>Cancel</s-button>
          <s-button variant="primary" onClick={() => onDone(picked)}>
            {`Show ${picked.length} metafield${picked.length === 1 ? "" : "s"}`}
          </s-button>
        </s-stack>
      }
    >
      <s-stack gap="base">
        <TextBox label="Search metafields" value={search} onChange={setSearch} placeholder="Name, namespace.key or type" />
        {defs.length === 0 ? <s-text color="subdued">This store has no metafield definitions for this kind of data.</s-text> : null}
        {groups.length === 0 && defs.length > 0 ? <s-text color="subdued">Nothing matches your search.</s-text> : null}
        {groups.map(([namespace, list]) => (
          <s-stack key={namespace} gap="small-200">
            <s-text type="strong">{namespace}</s-text>
            {list.map((d) => {
              const key = defKey(d);
              const support = supportOf(d.type);
              return (
                <s-checkbox
                  key={key}
                  label={`${d.name} · ${key} · ${typeLabel(d.type)}${support.editable ? "" : " (shown only)"}`}
                  checked={picked.includes(key) || undefined}
                  ref={onChecked((on) => toggle(key, on))}
                />
              );
            })}
          </s-stack>
        ))}
      </s-stack>
    </Dialog>
  );
}

/** Saved sets: a named choice of rows, kept inside Shopify. Saving asks for the password. */
function SavedSets({ edit, shared }: { edit: EditState; shared: EditorShared }) {
  const guard = useGuard();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const settings = shared.settings.data;
  const sets = settings?.sets ?? [];
  const total = edit.chosen.product.length + edit.chosen.variant.length;

  const persist = async (next: SavedSet[], done: string) => {
    if (!settings) return;
    setBusy(true);
    setMessage("");
    try {
      await saveSets(liveGql, settings.installationId, next);
      shared.settings.set({ ...settings, sets: next });
      setMessage(done);
      setName("");
    } catch (e) {
      setMessage(`Not saved: ${messageOf(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-stack gap="small-200">
      {guard.modal}
      {shared.settings.status === "error" ? <s-text tone="critical">{`Saved sets could not be read: ${shared.settings.error}`}</s-text> : null}
      <s-stack direction="inline" gap="small-200" alignItems="end">
        {sets.length > 0 ? (
          <SelectField
            label="Load a saved set"
            value=""
            options={[{ value: "", label: "Choose a set…" }, ...sets.map((s) => ({ value: s.id, label: `${s.name} (${s.product.length + s.variant.length})` }))]}
            onChange={(id) => {
              const set = sets.find((s) => s.id === id);
              if (set) {
                edit.setChosen("product", set.product);
                edit.setChosen("variant", set.variant);
              }
            }}
          />
        ) : null}
        <TextBox label="Save the rows shown as a set" value={name} onChange={setName} placeholder="For example Dining tables" />
        <s-button disabled={!name.trim() || total === 0 || !settings || busy || undefined} onClick={() => guard.ask(() => persist([...sets, { id: newId(), name: name.trim(), product: edit.chosen.product, variant: edit.chosen.variant }], "Set saved."))}>
          Save set
        </s-button>
      </s-stack>
      {sets.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer" }}>
            <s-text color="subdued">Delete a saved set</s-text>
          </summary>
          <s-stack gap="small-200">
            {sets.map((s) => (
              <s-stack key={s.id} direction="inline" gap="small-200" alignItems="center">
                <s-text>{s.name}</s-text>
                <s-button variant="tertiary" tone="critical" disabled={busy || undefined} onClick={() => guard.ask(() => persist(sets.filter((x) => x.id !== s.id), "Set deleted."))}>
                  Delete
                </s-button>
              </s-stack>
            ))}
          </s-stack>
        </details>
      ) : null}
      {message ? <s-text color="subdued">{message}</s-text> : null}
      <s-text color="subdued">Sets are stored in Shopify (in the app's own data), so everyone who opens the app sees them.</s-text>
    </s-stack>
  );
}

function MetafieldRow({
  edit,
  shared,
  doc,
  def,
  ownerId,
  ownerKind,
  variantName,
  onRemove,
}: Props & { def: RowDef; ownerId: string; ownerKind: OwnerKind; variantName?: string; onRemove: () => void }) {
  const key = mfKey(def.namespace, def.key);
  const type = def.type;
  const target: Target = { kind: "metafield", productId: doc.id, ownerId, ownerKind, namespace: def.namespace, key: def.key, type };
  const tkey = targetKey(target);
  const owner = ownerKind === "PRODUCT" ? doc.metafields[key] : doc.variants.find((v) => v.id === ownerId)?.metafields[key];
  const saved = owner?.value ?? null;
  const support = supportOf(type);
  const editable = support.editable && valueEditable(type, saved);
  const edited = tkey in edit.edits;
  const [asking, setAsking] = useState(false);

  const drafts = edit.drafts[tkey] ?? draftsFromStored(type, edit.effectiveValue(target), def.validations, edit.labels);
  const built = useMemo(() => storedFromDrafts(type, drafts, def.validations), [type, drafts, def.validations]);
  const error = edit.edits[tkey]?.error ?? null;

  const change = (next: Draft[]) => {
    const b = storedFromDrafts(type, next, def.validations);
    edit.putDrafts(target, next, { value: b.value, error: b.error });
  };

  const name = variantName ? `${def.name} · ${variantName}` : def.name;

  // Translations: the saved metafield is the thing that is translated.
  const resourceId = owner?.id ?? null;
  const showTranslations = shared.slots.length > 0 && editable && translatableHere(type);
  const sourceText = edit.effectiveValue(target) ?? "";
  const sourceEdited = edited;
  const cells: LangCell[] = showTranslations
    ? shared.slots.map((slot) => {
        const t: Target = { kind: "translation", productId: doc.id, resourceId: resourceId ?? "", resource: "metafield", field: "value", slot: slot.key, mfType: type };
        const savedTr = resourceId ? doc.translations[resourceId]?.values.value?.[slot.key] : undefined;
        const value = resourceId ? (edit.effectiveValue(t) ?? "") : "";
        const isEdited = Boolean(resourceId) && targetKey(t) in edit.edits;
        const outdated = (savedTr?.outdated ?? false) || (sourceEdited && !isEdited && normText(savedTr?.value) !== "");
        return {
          slot,
          value,
          status: translationStatus(sourceText, value, outdated),
          changed: isEdited,
          editable: Boolean(resourceId) && saved !== null,
          note: resourceId ? undefined : "Save the value first, then translate it.",
          onChange: (text: string) => edit.put(t, text === "" ? null : text),
        };
      })
    : [];

  const removeRow = () => {
    const keys = Object.keys(edit.edits).filter((k) => k === tkey || (resourceId && k.startsWith(`t|${resourceId}|`)));
    edit.discard(keys);
    onRemove();
  };
  const hasEdits = edited || Object.keys(edit.edits).some((k) => resourceId && k.startsWith(`t|${resourceId}|`));

  const header = (
    <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-text color="subdued">{`${key} · ${typeLabel(type)}`}</s-text>
        {edited ? <s-badge tone="info">Edited</s-badge> : null}
      </s-stack>
      {asking ? (
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text>Remove this row and discard its unsaved edits?</s-text>
          <s-button tone="critical" onClick={removeRow}>
            Yes, remove
          </s-button>
          <s-button onClick={() => setAsking(false)}>Keep</s-button>
        </s-stack>
      ) : (
        <s-button variant="tertiary" accessibilityLabel={`Remove the ${name} row`} onClick={() => (hasEdits ? setAsking(true) : removeRow())}>
          Remove row
        </s-button>
      )}
    </s-stack>
  );

  if (!editable) {
    const reason = support.editable ? "This rich text has formatting this app cannot keep exactly, so it is shown and not edited. Change it in Shopify." : support.reason;
    return (
      <s-section heading={name}>
        <s-stack gap="small-200">
          {header}
          <s-text>{saved === null ? "No value" : formatValue(type, saved, edit.labels)}</s-text>
          <s-text color="subdued">{reason}</s-text>
        </s-stack>
      </s-section>
    );
  }

  const editor = (
    <ValueEditor type={type} validations={def.validations} drafts={drafts} onChange={change} itemErrors={built.itemErrors} error={error} name={name} />
  );

  if (!showTranslations) {
    return (
      <s-section heading={name}>
        <s-stack gap="small-200">
          {header}
          {def.description ? <s-text color="subdued">{def.description}</s-text> : null}
          {editor}
          {shared.slots.length > 0 && !translatableMetafield(type) ? <s-text color="subdued">Shopify does not translate this type of value here.</s-text> : null}
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-stack gap="small-200">
      {header}
      <FieldBlock
        label={name}
        hint={def.description || undefined}
        primaryName={primaryLocale(shared.info.data?.locales ?? [])?.name ?? "Primary language"}
        sourceText={sourceText}
        multiline={inputKindOf(type) === "multiline"}
        rows={3}
        changed={edited}
        cells={cells}
        source={editor}
      />
    </s-stack>
  );
}

export function MetafieldsTab({ edit, shared, doc, ownerKind }: Props & { ownerKind: OwnerKind }) {
  const kind = ownerKind === "PRODUCT" ? "product" : "variant";
  const defsLazy = ownerKind === "PRODUCT" ? shared.productDefs : shared.variantDefs;
  const defs = defsLazy.data ?? [];
  const chosen = edit.chosen[kind];
  const [choosing, setChoosing] = useState(false);

  const rows = chosen.map((k): RowDef | null => {
    const found = defs.find((d) => defKey(d) === k);
    if (found) return found;
    // No definition (it was removed, or the set is old): show it from the value on the product when there is one.
    const dot = k.indexOf(".");
    const sample = ownerKind === "PRODUCT" ? doc.metafields[k] : doc.variants.map((v) => v.metafields[k]).find(Boolean);
    return sample ? { namespace: k.slice(0, dot), key: k.slice(dot + 1), name: k.slice(dot + 1), type: sample.type, validations: [] } : null;
  });

  const owners = ownerKind === "PRODUCT" ? [{ id: doc.id, name: undefined as string | undefined }] : doc.variants.map((v) => ({ id: v.id, name: variantTitle(v) }));
  const loadingVariants = ownerKind === "PRODUCTVARIANT" && chosen.some((k) => doc.variants.some((v) => !(k in v.metafields)));

  return (
    <s-stack gap="base">
      <s-section heading={ownerKind === "PRODUCT" ? "Product metafields" : "Variant metafields"}>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-button variant={chosen.length === 0 ? "primary" : "secondary"} disabled={defsLazy.status !== "ready" || undefined} onClick={() => setChoosing(true)}>
              {chosen.length === 0 ? "Choose metafields" : `Choose metafields (${chosen.length} shown)`}
            </s-button>
            {defsLazy.status === "loading" || defsLazy.status === "idle" ? <Loading message="Reading metafield definitions…" /> : null}
          </s-stack>
          {defsLazy.status === "error" ? (
            <s-banner tone="critical" heading="Could not read the metafield definitions">
              <s-paragraph>{defsLazy.error}</s-paragraph>
              <s-button slot="secondary-actions" onClick={defsLazy.reload}>
                Try again
              </s-button>
            </s-banner>
          ) : null}
          <SavedSets edit={edit} shared={shared} />
        </s-stack>
      </s-section>

      {chosen.length === 0 ? (
        <s-section>
          <s-text color="subdued">No metafields are shown. Choose the ones you want to work on. Only those are read and shown, so the page stays fast.</s-text>
        </s-section>
      ) : null}

      {loadingVariants ? <Loading message="Reading the variants' metafields…" /> : null}

      {owners.map((o) => (
        <s-stack key={o.id} gap="base">
          {o.name !== undefined && chosen.length > 0 ? <s-heading>{o.name}</s-heading> : null}
          {rows.map((def, i) =>
            def ? (
              <MetafieldRow key={`${o.id}-${chosen[i]}`} edit={edit} shared={shared} doc={doc} def={def} ownerId={o.id} ownerKind={ownerKind} variantName={o.name} onRemove={() => edit.setChosen(kind, chosen.filter((k) => k !== chosen[i]))} />
            ) : (
              <s-section key={`${o.id}-${chosen[i]}`} heading={chosen[i]}>
                <s-stack gap="small-200">
                  <s-text color="subdued">This metafield has no definition in the store any more and no value here.</s-text>
                  <div>
                    <s-button variant="tertiary" onClick={() => edit.setChosen(kind, chosen.filter((k) => k !== chosen[i]))}>
                      Remove row
                    </s-button>
                  </div>
                </s-stack>
              </s-section>
            ),
          )}
        </s-stack>
      ))}

      {choosing ? (
        <MetafieldChooser
          heading={ownerKind === "PRODUCT" ? "Choose product metafields" : "Choose variant metafields"}
          defs={defs}
          chosen={chosen}
          onClose={() => setChoosing(false)}
          onDone={(keys) => {
            edit.setChosen(kind, keys);
            setChoosing(false);
          }}
        />
      ) : null}
    </s-stack>
  );
}
