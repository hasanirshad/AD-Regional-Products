// Builds every block extension the way the Shopify CLI does (esbuild, one bundle each) and checks the rules
// Shopify enforces at deploy: bundle at most 64 KB, unique handle and uid, name 5-30 characters, module exists.
// Usage: node scripts/check-extensions.mjs        (exit code 1 on any problem)
import { build } from "esbuild";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../extensions/", import.meta.url));
const LIMIT = 64 * 1024;
const problems = [];
const seen = { handle: new Map(), uid: new Map(), name: new Map() };

const dirs = readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, "shopify.extension.toml")));
if (!dirs.length) problems.push("No extensions found.");

const field = (toml, key) => new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(toml)?.[1] ?? "";

for (const dir of dirs) {
  const toml = readFileSync(join(ROOT, dir, "shopify.extension.toml"), "utf8");
  const name = field(toml, "name");
  const handle = field(toml, "handle");
  const uid = field(toml, "uid");
  const target = field(toml, "target");
  const module = field(toml, "module");
  const where = `${dir}: `;

  if (field(toml, "api_version") !== "2026-10") problems.push(`${where}api_version is not 2026-10`);
  if (field(toml, "type") !== "ui_extension") problems.push(`${where}type is not ui_extension`);
  if (name.length < 5 || name.length > 30) problems.push(`${where}name "${name}" must be 5-30 characters`);
  if (!/^[A-Za-z0-9-]{1,100}$/.test(handle)) problems.push(`${where}bad handle "${handle}"`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uid)) problems.push(`${where}uid is not a uuid`);
  if (target !== "admin.product-details.block.render") problems.push(`${where}target is "${target}"`);
  for (const [k, v] of [["handle", handle], ["uid", uid], ["name", name]]) {
    if (seen[k].has(v)) problems.push(`${where}${k} "${v}" is also used by ${seen[k].get(v)}`);
    seen[k].set(v, dir);
  }
  const entry = join(ROOT, dir, module);
  if (!existsSync(entry)) {
    problems.push(`${where}module ${module} not found`);
    continue;
  }
  try {
    const out = await build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: "esm",
      target: "es2022",
      write: false,
      jsx: "automatic",
      jsxImportSource: "preact",
      tsconfig: join(ROOT, "tsconfig.json"),
      logLevel: "silent",
    });
    const bytes = out.outputFiles.reduce((n, f) => n + f.contents.length, 0);
    const text = out.outputFiles[0].text;
    const kb = (bytes / 1024).toFixed(1);
    console.log(`${dir.padEnd(22)} ${name.padEnd(24)} ${kb.padStart(6)} KB`);
    if (bytes > LIMIT) problems.push(`${where}bundle is ${kb} KB, over the 64 KB limit`);
    if (!/export\s*\{[^}]*default/.test(text) && !/export default/.test(text)) problems.push(`${where}the bundle has no default export`);
    if (/\bmutation\b\s*[A-Za-z{(]/.test(text)) problems.push(`${where}the bundle contains the word "mutation" in a query-like position`);
  } catch (e) {
    problems.push(`${where}build failed: ${e instanceof Error ? e.message : e}`);
  }
}

if (problems.length) {
  console.error("\nProblems:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`\n${dirs.length} extensions OK`);
