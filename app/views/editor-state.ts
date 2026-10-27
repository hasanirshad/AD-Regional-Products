// What the Edit product and Bulk edit pages share: the store's languages and locations, the metafield definitions,
// the saved choices (sets, bookmarks) and the Undo record. Everything is read from Shopify when a page first needs it,
// and kept here (in the layout) so moving between pages never reads it twice. Reading is free.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liveGql, messageOf } from "../lib/editor/gql";
import { loadDefinitions, loadShopInfo, type Definition, type ShopInfo } from "../lib/editor/load";
import { slotsFromLocales, type Slot } from "../lib/editor/locales";
import { loadSettings, type Settings, type UndoRecord } from "../lib/editor/settings";

export type Lazy<T> = {
  status: "idle" | "loading" | "ready" | "error";
  data: T | null;
  error: string;
  /** Starts reading once. A failed read is retried with `reload`. */
  load: () => void;
  reload: () => void;
  /** Replaces the data after a save, without reading again. */
  set: (data: T) => void;
};

export function useLazy<T>(read: () => Promise<T>): Lazy<T> {
  const [status, setStatus] = useState<Lazy<T>["status"]>("idle");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const running = useRef(false);
  const readRef = useRef(read);
  readRef.current = read;

  const run = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setStatus("loading");
    setError("");
    readRef
      .current()
      .then((d) => {
        setData(d);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        setError(messageOf(e));
        setStatus("error");
      })
      .finally(() => {
        running.current = false;
      });
  }, []);

  const load = useCallback(() => {
    if (status === "idle") run();
  }, [status, run]);

  return useMemo(() => ({ status, data, error, load, reload: run, set: (d: T) => { setData(d); setStatus("ready"); } }), [status, data, error, load, run]);
}

export type EditorShared = {
  info: Lazy<ShopInfo>;
  productDefs: Lazy<Definition[]>;
  variantDefs: Lazy<Definition[]>;
  settings: Lazy<Settings>;
  /** The slots (store languages other than the primary one). Empty until the shop info is read. */
  slots: Slot[];
  /** The last save that can be undone: from this session, or the one saved in Shopify. */
  undo: UndoRecord | null;
  /** Remember the last save here (also when it was too big to store in Shopify). null = nothing to undo. */
  setUndo: (record: UndoRecord | null) => void;
};

export function useEditorShared(): EditorShared {
  const info = useLazy(() => loadShopInfo(liveGql));
  const productDefs = useLazy(() => loadDefinitions(liveGql, "PRODUCT"));
  const variantDefs = useLazy(() => loadDefinitions(liveGql, "PRODUCTVARIANT"));
  const settings = useLazy(() => loadSettings(liveGql));
  const [override, setOverride] = useState<{ record: UndoRecord | null } | null>(null);

  const slots = useMemo(() => (info.data ? slotsFromLocales(info.data.locales) : []), [info.data]);
  const undo = override ? override.record : (settings.data?.undo ?? null);
  const setUndo = useCallback((record: UndoRecord | null) => setOverride({ record }), []);

  return useMemo(() => ({ info, productDefs, variantDefs, settings, slots, undo, setUndo }), [info, productDefs, variantDefs, settings, slots, undo, setUndo]);
}

/** Starts the reads a page needs, once. */
export function useStartEditor(shared: EditorShared, which: ("info" | "productDefs" | "variantDefs" | "settings")[]) {
  const key = which.join(",");
  useEffect(() => {
    for (const w of key.split(",")) (shared[w as "info"] as Lazy<unknown>).load();
  }, [key, shared.info.load, shared.productDefs.load, shared.variantDefs.load, shared.settings.load]); // eslint-disable-line react-hooks/exhaustive-deps
}
