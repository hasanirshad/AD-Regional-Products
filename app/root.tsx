import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

// Head order matters (playbook gotcha 8): App Bridge is the FIRST script,
// not async or deferred. The Polaris script follows it.
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="shopify-api-key" content={import.meta.env.SHOPIFY_API_KEY} />
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

// Shown by React Router while the SPA hydrates.
export function HydrateFallback() {
  return (
    <s-page heading="Loading…">
      <s-section>
        <s-spinner accessibilityLabel="Loading the app" />
      </s-section>
    </s-page>
  );
}
