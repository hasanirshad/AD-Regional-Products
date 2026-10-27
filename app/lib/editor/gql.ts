// How the editor talks to Shopify. The functions in this folder take a `Gql` so tests can pass a fake store.
// The live one is the app's normal client (timeout, retry, cost pause, and the rule that mutations need the password).

import { adminGraphql } from "../admin";

export type Gql = <T = unknown>(query: string, variables?: Record<string, unknown>) => Promise<T>;

export const liveGql: Gql = <T,>(query: string, variables: Record<string, unknown> = {}) => adminGraphql<T>(query, variables);

export type UserError = { field?: string[] | null; message: string; code?: string | null };

/** One readable line from Shopify's userErrors. Empty text means no errors. */
export function formatUserErrors(errors: UserError[] | null | undefined): string {
  if (!errors || errors.length === 0) return "";
  return errors
    .map((e) => {
      const where = e.field && e.field.length > 0 ? e.field.filter((f) => f !== "input" && f !== "product" && f !== "variants").join(" › ") : "";
      return where ? `${e.message} (${where})` : e.message;
    })
    .join("; ");
}

export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Splits a list into groups of at most `size`. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A GraphQL string literal for text typed by a person (metafield namespace and key in aliased reads). */
export const gqlString = (s: string): string => JSON.stringify(s);
