// The Edit product page's working state: the products opened, what has been typed but not saved, the metafield rows
// chosen, and the "Create product" progress. It lives in the layout, so leaving the page and coming back loses nothing.
// Edits to several products can wait together; the review lists them all.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildChanges, type BuiltChanges, type ChangeContext } from "../lib/editor/changes";
import { baseOf, mfKey, variantTitle, type ProductDoc } from "../lib/editor/doc";
import { editCount, effective, putEdit, removeEdits, type EditMap } from "../lib/editor/edits";
import { liveGql, messageOf } from "../lib/editor/gql";
import { defKey, loadProductDoc, loadRefLabels, loadTranslations, loadVariantMetafields } from "../lib/editor/load";
import { referenceIds } from "../lib/editor/mfTypes";
import type { Draft } from "../lib/editor/mfTypes";
import { targetKey, type TabId, type Target, type Value } from "../lib/editor/model";
import type { CreateStep } from "../lib/editor/settings";
import type { EditorShared } from "./editor-state";

export type CreateState = { productId: string; step: CreateStep };
export type Mode = "edit" | "review" | "undo" | "options" | "create-first";

export type EditState = {
  productId: string | null;
  doc: ProductDoc | null;
  docs: Record<string, ProductDoc>;
  loading: boolean;
  error: string;
  open: (id: string) => Promise<void>;
  close: () => void;
  /** Reads these products again (after a save). */
  refresh: (ids: string[]) => Promise<void>;

  edits: EditMap;
  put: (target: Target, value: Value, extra?: { draft?: Draft[]; error?: string | null }) => void;
  /** The boxes of a metafield row, kept apart from the edits so half-typed text is never overwritten. */
  drafts: Record<string, Draft[]>;
  putDrafts: (target: Target, drafts: Draft[], built: { value: Value; error: string | null }) => void;
  baseValue: (target: Target) => Value;
  effectiveValue: (target: Target) => Value;
  discard: (keys: string[]) => void;
  discardAll: () => void;
  built: BuiltChanges;
  ctx: ChangeContext;

  tab: TabId;
  setTab: (t: TabId) => void;
  chosen: { product: string[]; variant: string[] };
  setChosen: (kind: "product" | "variant", keys: string[]) => void;
  /** Names of referenced products, collections and variants, by id. */
  labels: Record<string, string>;
  addLabels: (more: Record<string, string>) => void;

  mode: Mode;
  setMode: (m: Mode) => void;
  create: CreateState | null;
  setCreate: (c: CreateState | null) => void;
};

export function useEditState(shared: EditorShared): EditState {
  const [productId, setProductId] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, ProductDoc>>({});
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [edits, setEdits] = useState<EditMap>({});
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({});
  const [tab, setTab] = useState<TabId>("basic");
  const [chosen, setChosenState] = useState<{ product: string[]; variant: string[] }>({ product: [], variant: [] });
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>("edit");
  const [create, setCreate] = useState<CreateState | null>(null);

  const slotKeys = useMemo(() => shared.slots.map((s) => s.key), [shared.slots]);
  const slotKeysRef = useRef(slotKeys);
  slotKeysRef.current = slotKeys;
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;

  // ---- reading products

  /** Variant metafields are read only for the rows chosen. */
  const withVariantMetafields = useCallback(async (doc: ProductDoc, keys: string[]): Promise<ProductDoc> => {
    const wanted = keys.filter((k) => doc.variants.some((v) => !(k in v.metafields)));
    if (wanted.length === 0 || doc.variants.length === 0) return doc;
    const pairs = wanted.map((k) => {
      const dot = k.indexOf(".");
      return { namespace: k.slice(0, dot), key: k.slice(dot + 1) };
    });
    const found = await loadVariantMetafields(liveGql, doc.variants.map((v) => v.id), pairs);
    const ids = Object.values(found).flatMap((row) => Object.values(row).flatMap((m) => (m ? [m.id] : [])));
    const tr = ids.length > 0 && slotKeysRef.current.length > 0 ? await loadTranslations(liveGql, ids, slotKeysRef.current) : {};
    return {
      ...doc,
      variants: doc.variants.map((v) => ({ ...v, metafields: { ...v.metafields, ...Object.fromEntries(wanted.map((k) => [k, found[v.id]?.[k] ?? null])) } })),
      translations: { ...doc.translations, ...tr },
    };
  }, []);

  const open = useCallback(
    async (id: string) => {
      setProductId(id);
      setError("");
      if (docsRef.current[id]) return;
      setLoading(true);
      try {
        const doc = await loadProductDoc(liveGql, id, slotKeysRef.current);
        const full = await withVariantMetafields(doc, chosenRef.current.variant);
        setDocs((d) => ({ ...d, [id]: full }));
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setLoading(false);
      }
    },
    [withVariantMetafields],
  );

  const refresh = useCallback(
    async (ids: string[]) => {
      for (const id of [...new Set(ids)]) {
        try {
          const doc = await loadProductDoc(liveGql, id, slotKeysRef.current);
          const full = await withVariantMetafields(doc, chosenRef.current.variant);
          setDocs((d) => ({ ...d, [id]: full }));
        } catch (e) {
          setError(messageOf(e));
        }
      }
    },
    [withVariantMetafields],
  );

  const doc = productId ? (docs[productId] ?? null) : null;

  // Variant rows chosen after the product was opened: read them now.
  const variantKey = chosen.variant.join("|");
  useEffect(() => {
    const current = productId ? docsRef.current[productId] : undefined;
    if (!current || chosen.variant.length === 0) return;
    if (!chosen.variant.some((k) => current.variants.some((v) => !(k in v.metafields)))) return;
    let cancelled = false;
    withVariantMetafields(current, chosen.variant)
      .then((full) => !cancelled && setDocs((d) => ({ ...d, [full.id]: full })))
      .catch((e) => !cancelled && setError(messageOf(e)));
    return () => {
      cancelled = true;
    };
  }, [productId, variantKey, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Names of the items a reference metafield points to.
  const refKey = useMemo(() => {
    if (!doc) return "";
    const ids = new Set<string>();
    for (const m of Object.values(doc.metafields)) for (const id of referenceIds(m.type, m.value)) ids.add(id);
    for (const v of doc.variants) for (const m of Object.values(v.metafields)) if (m) for (const id of referenceIds(m.type, m.value)) ids.add(id);
    return [...ids].filter((id) => !(id in labels)).sort().join(",");
  }, [doc, labels]);
  useEffect(() => {
    if (!refKey) return;
    let cancelled = false;
    loadRefLabels(liveGql, refKey.split(","))
      .then((found) => !cancelled && setLabels((l) => ({ ...found, ...l })))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refKey]);

  // ---- edits

  const baseValue = useCallback((t: Target): Value => {
    const d = docsRef.current[t.productId];
    return d ? baseOf(d, t) : null;
  }, []);

  const put = useCallback((target: Target, value: Value, extra?: { draft?: Draft[]; error?: string | null }) => {
    setEdits((e) => {
      const d = docsRef.current[target.productId];
      return putEdit(e, target, value, d ? baseOf(d, target) : null, extra);
    });
  }, []);

  const putDrafts = useCallback((target: Target, next: Draft[], built: { value: Value; error: string | null }) => {
    const key = targetKey(target);
    setDrafts((d) => ({ ...d, [key]: next }));
    setEdits((e) => {
      const d = docsRef.current[target.productId];
      return putEdit(e, target, built.value, d ? baseOf(d, target) : null, { error: built.error });
    });
  }, []);

  const effectiveValue = useCallback((t: Target): Value => effective(edits, t, baseValue(t)), [edits, baseValue]);
  const discard = useCallback((keys: string[]) => {
    setEdits((e) => removeEdits(e, keys));
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
  }, []);
  const discardAll = useCallback(() => {
    setEdits({});
    setDrafts({});
  }, []);
  const setChosen = useCallback((kind: "product" | "variant", keys: string[]) => setChosenState((c) => ({ ...c, [kind]: keys })), []);
  const addLabels = useCallback((more: Record<string, string>) => setLabels((l) => ({ ...l, ...more })), []);

  // ---- the review

  const defs = shared.productDefs.data;
  const vdefs = shared.variantDefs.data;
  const locations = shared.info.data?.locations;
  const slots = shared.slots;
  const ctx = useMemo<ChangeContext>(() => {
    const nameOf = new Map<string, string>();
    for (const d of defs ?? []) nameOf.set(`P|${defKey(d)}`, d.name);
    for (const d of vdefs ?? []) nameOf.set(`V|${defKey(d)}`, d.name);
    return {
      baseOf: (t) => {
        const d = docs[t.productId];
        return d ? baseOf(d, t) : null;
      },
      effectiveOf: (t) => {
        const d = docs[t.productId];
        return effective(edits, t, d ? baseOf(d, t) : null);
      },
      productTitle: (id) => docs[id]?.title ?? "Product",
      productHandle: (id) => docs[id]?.handle ?? "",
      variantTitle: (variantId) => {
        for (const d of Object.values(docs)) {
          const v = d.variants.find((x) => x.id === variantId);
          if (v) return variantTitle(v);
        }
        return "Variant";
      },
      slotLabel: (slot) => slots.find((s) => s.key === slot)?.label ?? slot,
      locationName: (id) => locations?.find((l) => l.id === id)?.name ?? "Location",
      metafieldName: (t) => nameOf.get(`${t.ownerKind === "PRODUCT" ? "P" : "V"}|${mfKey(t.namespace, t.key)}`) ?? mfKey(t.namespace, t.key),
    };
  }, [docs, edits, defs, vdefs, locations, slots]);
  const built = useMemo(() => buildChanges(edits, ctx), [edits, ctx]);

  // ---- leaving the page with unsaved edits
  const dirty = editCount(edits) > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const close = useCallback(() => setProductId(null), []);

  return useMemo(
    () => ({
      productId,
      doc,
      docs,
      loading,
      error,
      open,
      close,
      refresh,
      edits,
      put,
      drafts,
      putDrafts,
      baseValue,
      effectiveValue,
      discard,
      discardAll,
      built,
      ctx,
      tab,
      setTab,
      chosen,
      setChosen,
      labels,
      addLabels,
      mode,
      setMode,
      create,
      setCreate,
    }),
    [productId, doc, docs, loading, error, open, close, refresh, edits, put, drafts, putDrafts, baseValue, effectiveValue, discard, discardAll, built, ctx, tab, chosen, setChosen, labels, addLabels, mode, create],
  );
}

