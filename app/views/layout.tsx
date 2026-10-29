import { useEffect, useMemo, useState } from "react";
import type { BlockSettings } from "../../extensions/shared/settings";
import { Outlet } from "react-router";
import { Gate } from "../components/Gate";
import { NO_INV_FILTERS, type InvFilters } from "../lib/inventoryFilter";
import { useBulkState } from "./bulk-state";
import { useVariantBulk } from "./bulk-variants-state";
import { useEditState } from "./edit-state";
import { useEditorShared } from "./editor-state";
import { useProductsLoad, useProductsUi, type Shared } from "./products-state";
import { MARKET_DRIVEN_MESSAGE, readShippingMode } from "../lib/shippingMode";
import { useLoadAppState } from "./state";

// Layout: navigation, shared state, loading and error shell.
// Overview is the home route, then Products.
export default function Layout() {
  const { loaded, reload } = useLoadAppState();
  const app = loaded.status === "ready" ? loaded.state : null;
  const products = useProductsLoad(app);
  const ui = useProductsUi();
  const channelsUi = useProductsUi();
  const linksUi = useProductsUi();
  const checkUi = useProductsUi();
  const inventoryUi = useProductsUi();
  const [invFilters, setInvFilters] = useState<InvFilters>(NO_INV_FILTERS);
  const [blockDraft, setBlockDraft] = useState<BlockSettings | null>(null);
  const [marketDriven, setMarketDriven] = useState(false);
  const ready = loaded.status === "ready";
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void readShippingMode().then((mode) => live && setMarketDriven(mode === "market-driven"));
    return () => {
      live = false;
    };
  }, [ready]);
  const marketIds = useMemo(() => (app ? app.markets.map((m) => m.id) : null), [app]);
  const editor = useEditorShared(marketIds);
  const edit = useEditState(editor);
  const bulk = useBulkState(editor, products);
  const variantBulk = useVariantBulk(editor);

  const shared = useMemo<Shared | null>(
    () => (app ? { ...app, products, ui, channelsUi, linksUi, checkUi, inventoryUi, invFilters: { value: invFilters, set: setInvFilters }, blockDraft: { value: blockDraft, set: setBlockDraft }, editor, edit, bulk, variantBulk } : null),
    [app, products, ui, channelsUi, linksUi, checkUi, inventoryUi, invFilters, blockDraft, editor, edit, bulk, variantBulk],
  );

  return (
    <>
      <s-app-nav>
        <s-link href="/">Overview</s-link>
        <s-link href="/products">Products</s-link>
        <s-link href="/channels">Channels &amp; catalogues</s-link>
        <s-link href="/inventory">Inventory</s-link>
        <s-link href="/links">Storefront links</s-link>
        <s-link href="/check">Product check</s-link>
        <s-link href="/edit">Edit product</s-link>
        <s-link href="/bulk">Bulk edit</s-link>
        <s-link href="/settings">Block settings</s-link>
      </s-app-nav>
      <Gate
        status={loaded.status}
        error={loaded.status === "error" ? loaded.message : undefined}
        onRetry={reload}
      >
        {marketDriven ? <s-banner tone="critical" heading="Shipping profiles are read-only here">{MARKET_DRIVEN_MESSAGE}</s-banner> : null}
        {shared ? <Outlet context={shared} /> : null}
      </Gate>
    </>
  );
}
