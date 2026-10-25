import { useMemo } from "react";
import { Outlet } from "react-router";
import { Gate } from "../components/Gate";
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

  const shared = useMemo<Shared | null>(
    () => (app ? { ...app, products, ui, channelsUi, linksUi } : null),
    [app, products, ui, channelsUi, linksUi],
  );

  return (
    <>
      <s-app-nav>
        <s-link href="/">Overview</s-link>
        <s-link href="/products">Products</s-link>
        <s-link href="/channels">Channels &amp; catalogues</s-link>
        <s-link href="/links">Storefront links</s-link>
        <s-link href="/check">Product check</s-link>
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
