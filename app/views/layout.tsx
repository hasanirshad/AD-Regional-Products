import { useMemo, useState } from "react";
import { Outlet } from "react-router";
import { Gate } from "../components/Gate";
import { NO_INV_FILTERS, type InvFilters } from "../lib/inventoryFilter";
import { useBulkState } from "./bulk-state";
import { useEditState } from "./edit-state";
import { useEditorShared } from "./editor-state";
import { useProductsLoad, useProductsUi, type Shared } from "./products-state";
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
  const editor = useEditorShared();
  const edit = useEditState(editor);
  const bulk = useBulkState(editor, products);

  const shared = useMemo<Shared | null>(
    () => (app ? { ...app, products, ui, channelsUi, linksUi, checkUi, inventoryUi, invFilters: { value: invFilters, set: setInvFilters }, editor, edit, bulk } : null),
    [app, products, ui, channelsUi, linksUi, checkUi, inventoryUi, invFilters, editor, edit, bulk],
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
      </s-app-nav>
      <Gate
        status={loaded.status}
        error={loaded.status === "error" ? loaded.message : undefined}
        onRetry={reload}
      >
        {shared ? <Outlet context={shared} /> : null}
      </Gate>
    </>
  );
}
