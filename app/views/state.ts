// Shared app state. Loaded ONCE in the layout and shared with every page, so
// moving between pages never refetches (playbook principle 6).
// `refresh()` reloads quietly after a save, without clearing the page.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router";
import { EMPTY_GROUPS, GROUPS_KEY, parseGroupsFile } from "../lib/groups";
import { loadGeneral, loadMarkets, loadProfiles, loadShop } from "../lib/shopify-data";
import { readJson } from "../lib/store";
import type { GeneralProfile, Group, Market, ProfileSummary } from "../lib/types";
import type { Shared } from "./products-state";

export type AppData = {
  shop: { name: string; domain: string };
  markets: Market[];
  /** Catalogues of hidden markets. Products' catalogue lists ignore them. */
  hiddenCatalogIds: string[];
  profiles: ProfileSummary[];
  /** The General profile in full. Null if the store has no default profile. */
  general: GeneralProfile | null;
  groups: Group[];
};

export type AppState = AppData & {
  /** Reload everything quietly (the page keeps showing while it loads). */
  refresh: () => Promise<void>;
};

async function loadAll(): Promise<AppData> {
  const [shop, marketData, profiles, saved] = await Promise.all([
    loadShop(),
    loadMarkets(),
    loadProfiles(),
    readJson<unknown>(GROUPS_KEY, EMPTY_GROUPS),
  ]);
  const defaultProfile = profiles.find((p) => p.isDefault);
  const general = defaultProfile ? await loadGeneral(defaultProfile.id) : null;
  const { markets, hiddenCatalogIds } = marketData;
  return { shop, markets, hiddenCatalogIds, profiles, general, groups: parseGroupsFile(saved).groups };
}

export type Loaded =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; state: AppState };

export function useLoadAppState(): { loaded: Loaded; reload: () => void } {
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [data, setData] = useState<AppData | null>(null);

  const reload = useCallback(() => {
    setStatus("loading");
    loadAll()
      .then((d) => {
        setData(d);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  const refresh = useCallback(async () => {
    setData(await loadAll());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const loaded = useMemo<Loaded>(() => {
    if (status === "ready" && data) return { status: "ready", state: { ...data, refresh } };
    if (status === "error") return { status: "error", message: error };
    return { status: "loading" };
  }, [status, data, error, refresh]);

  return { loaded, reload };
}

/** Used by pages: the state the layout loaded. */
export function useAppState(): Shared {
  return useOutletContext<Shared>();
}
