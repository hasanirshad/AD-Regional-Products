// Runs after `react-router build`. Adds <link rel="modulepreload"> hints for the
// layout and the home route to build/client/index.html, so the first paint is
// faster. It never fails the build: on any problem it logs and exits 0.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CLIENT = "build/client";
const ROUTE_IDS = ["views/layout", "views/overview"];

try {
  const indexPath = join(CLIENT, "index.html");
  if (!existsSync(indexPath)) {
    console.warn("[preload] build/client/index.html not found, skipping.");
    process.exit(0);
  }
  const html = readFileSync(indexPath, "utf8");

  const manifestFile = readdirSync(join(CLIENT, "assets")).find((f) => /^manifest-.*\.js$/.test(f));
  if (!manifestFile) {
    console.warn("[preload] route manifest not found, skipping.");
    process.exit(0);
  }
  const text = readFileSync(join(CLIENT, "assets", manifestFile), "utf8");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const manifest = JSON.parse(text.slice(start, end + 1));

  const wanted = new Set();
  for (const id of ROUTE_IDS) {
    const route = manifest.routes?.[id];
    if (!route) continue;
    if (route.module) wanted.add(route.module);
    for (const imp of route.imports ?? []) wanted.add(imp);
  }

  const missing = [...wanted].filter((href) => !html.includes(`href="${href}"`));
  if (missing.length === 0) {
    console.log("[preload] nothing to add.");
    process.exit(0);
  }

  const tags = missing.map((href) => `<link rel="modulepreload" href="${href}">`).join("");
  writeFileSync(indexPath, html.replace("</head>", `${tags}</head>`));
  console.log(`[preload] added ${missing.length} modulepreload hints.`);
} catch (err) {
  console.warn("[preload] skipped:", err instanceof Error ? err.message : err);
  process.exit(0);
}
