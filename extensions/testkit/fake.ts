// A fake Shopify for the block tests: answers by operation name and records every query it saw.
import type { RawQuery } from "../shared/graphql";

export type Handler = (vars: Record<string, unknown>, query: string) => unknown;

export function fakeShopify(handlers: Record<string, Handler>) {
  const seen: { name: string; query: string; vars: Record<string, unknown> }[] = [];
  const raw: RawQuery = async (query, variables = {}) => {
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "";
    seen.push({ name, query, vars: variables });
    const h = handlers[name];
    if (!h) return { errors: [{ message: `No fake answer for ${name}` }] };
    try {
      const out = h(variables, query);
      if (out && typeof out === "object" && "__errors" in (out as object)) return { errors: (out as { __errors: never }).__errors };
      return { data: out };
    } catch (e) {
      return { errors: [{ message: e instanceof Error ? e.message : String(e) }] };
    }
  };
  return { raw, seen };
}

export const gqlError = (message: string, code?: string) => ({ __errors: [{ message, extensions: code ? { code } : undefined }] });
