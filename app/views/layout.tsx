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

  const shared = useMemo<Shared | null>(
    () => (app ? { ...app, products, ui } : null),
    [app, products, ui],
  );

  return (
    <>
      <s-app-nav>
        <s-link href="/">Overview</s-link>
        <s-link href="/products">Products</s-link>
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
