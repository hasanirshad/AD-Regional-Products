import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

// `shopify app dev` passes the tunnel URL in HOST / SHOPIFY_APP_URL.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;

const hmr =
  host === "localhost"
    ? { protocol: "ws", host: "localhost", port: 64999, clientPort: 64999 }
    : {
        protocol: "wss",
        host,
        port: parseInt(process.env.FRONTEND_PORT || "8002", 10),
        clientPort: 443,
      };

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: { preflightContinue: true },
    port: Number(process.env.PORT || 3000),
    hmr,
    fs: { allow: ["app", "node_modules"] },
  },
  plugins: [reactRouter()],
  build: { assetsInlineLimit: 0 },
  // App Bridge reads the client id from a <meta> tag (see app/root.tsx).
  // In dev the CLI sets SHOPIFY_API_KEY; on Cloudflare it is an env variable.
  define: {
    "import.meta.env.SHOPIFY_API_KEY": JSON.stringify(
      process.env.SHOPIFY_API_KEY ?? "",
    ),
  },
});
