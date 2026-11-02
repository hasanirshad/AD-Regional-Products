// The product page templates of the live theme ("product", "product.made-to-order", ...). A product points at one by its
// suffix: "" is the default template, "made-to-order" is templates/product.made-to-order.json. Reads only; needs read_themes.

import type { Gql } from "./gql";

export const TEMPLATES_QUERY = `#graphql
  query EditorTemplates {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        name
        files(first: 250, filenames: ["templates/product.*"]) { nodes { filename } }
      }
    }
  }`;

/** "templates/product.json" -> "", "templates/product.made-to-order.json" -> "made-to-order". Other files are ignored. */
export function suffixesFrom(filenames: string[]): string[] {
  const out = new Set<string>();
  for (const f of filenames) {
    const m = /^templates\/product(?:\.([A-Za-z0-9_-]+))?\.(?:json|liquid)$/.exec(f);
    if (m) out.add(m[1] ?? "");
  }
  return [...out].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
}

export const templateLabel = (suffix: string): string => (suffix === "" ? "Default product page" : `product.${suffix}`);

export async function loadProductTemplates(gql: Gql): Promise<{ theme: string; suffixes: string[] }> {
  const data = await gql<{ themes: { nodes: { name: string; files: { nodes: { filename: string }[] } | null }[] } }>(TEMPLATES_QUERY);
  const theme = data.themes.nodes[0];
  if (!theme) throw new Error("The live theme was not found.");
  return { theme: theme.name, suffixes: suffixesFrom((theme.files?.nodes ?? []).map((n) => n.filename)) };
}
