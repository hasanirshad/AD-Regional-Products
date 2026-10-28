// Small pure helpers for building queries. No Shopify global here, so the app (React) can import this file too.

/** GraphQL string literal. Used for values that come from constants. */
export const gqlString = (s: string) => JSON.stringify(s);

/** Country codes go into a query as enum values, so they are checked first. */
export function countryEnum(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) throw new Error(`Bad country code in constants: ${code}`);
  return code;
}

/** Locale codes go into a query as strings; only letters, digits and dashes are allowed. */
export function localeLiteral(code: string): string {
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) throw new Error(`Bad language code in constants: ${code}`);
  return gqlString(code);
}

/** Alias-safe suffix for a code like "pt-BR". */
export const aliasOf = (code: string) => code.replace(/[^A-Za-z0-9]/g, "_");

export const numericId = (gid: string) => gid.split("/").pop() ?? gid;
