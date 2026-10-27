// The only place that talks to Shopify. Read only: a query that starts with "mutation" is refused.

export type GqlError = { message: string; extensions?: { code?: string } };
export type RawQuery = (query: string, variables?: Record<string, unknown>) => Promise<{ data?: unknown; errors?: GqlError[] }>;

export type ErrorKind = "access" | "throttled" | "network" | "schema" | "graphql" | "missing";

/** An error with a message that can be shown to the merchant as it is. */
export class BlockError extends Error {
  kind: ErrorKind;
  detail: string;
  constructor(kind: ErrorKind, message: string, detail = "") {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}

export type Query = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
/** Like Query, but a partial answer is allowed: returns what Shopify sent plus the error text. */
export type SoftQuery = <T>(query: string, variables?: Record<string, unknown>) => Promise<{ data: T | null; error: BlockError | null }>;

export type LoadContext = { productId: string; q: Query; soft: SoftQuery };

export type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((r) => setTimeout(r, ms));

const THROTTLE_TRIES = 3;

/** GraphQL validation codes: the request itself is wrong for this API version, not the data. */
const SCHEMA_CODES = new Set(["undefinedField", "undefinedType", "argumentNotAccepted", "argumentLiteralsIncompatible", "missingRequiredArguments", "missingRequiredInputObjectAttribute", "variableMismatch", "INVALID_FIELD_ARGUMENTS"]);

export function explain(errors: GqlError[]): BlockError {
  const first = errors[0];
  const text = errors.map((e) => e.message).join("; ");
  const code = first?.extensions?.code ?? "";
  if (code === "ACCESS_DENIED" || /access denied/i.test(text)) {
    const scope = /`?(read_[a-z_]+|write_[a-z_]+)`?/.exec(text)?.[1];
    return new BlockError(
      "access",
      scope
        ? `This block needs the "${scope}" permission, which the app does not have yet. A store owner must approve the app's updated permissions, then reload the page.`
        : "Shopify says this app is not allowed to read this data. A store owner must approve the app's updated permissions, then reload the page.",
      text,
    );
  }
  if (code === "THROTTLED" || /throttled/i.test(text)) {
    return new BlockError("throttled", "Shopify is busy answering other requests. Reload the page in a moment.", text);
  }
  if (SCHEMA_CODES.has(code) || /doesn't exist on type|isn't a defined|Variable .* is not defined|invalid value|Argument .* on Field/i.test(text)) {
    return new BlockError("schema", "Shopify did not recognise part of this block's request. Tell the developer which block it is.", text);
  }
  return new BlockError("graphql", `Shopify could not answer this request: ${first?.message ?? "unknown error"}`, text);
}

const isThrottled = (errors: GqlError[]) => errors.some((e) => e.extensions?.code === "THROTTLED" || /throttled/i.test(e.message));

async function call(raw: RawQuery, query: string, variables: Record<string, unknown> | undefined, wait: Wait) {
  if (/^\s*mutation\b/i.test(query)) throw new BlockError("graphql", "This block is read only and cannot send changes.");
  for (let attempt = 1; ; attempt++) {
    let res: Awaited<ReturnType<RawQuery>>;
    try {
      res = await raw(query, variables);
    } catch (e) {
      throw new BlockError("network", "Could not reach Shopify. Check the connection and reload the page.", e instanceof Error ? e.message : String(e));
    }
    const errors = res.errors ?? [];
    if (errors.length && isThrottled(errors) && attempt < THROTTLE_TRIES) {
      await wait(1200 * attempt);
      continue;
    }
    return { data: (res.data ?? null) as unknown, errors };
  }
}

/** Builds the two query functions a block gets. `raw` is shopify.query in the browser and a fake in tests. */
export function makeQueries(raw: RawQuery, wait: Wait = sleep): { q: Query; soft: SoftQuery } {
  const q: Query = async <T,>(query: string, variables?: Record<string, unknown>) => {
    const { data, errors } = await call(raw, query, variables, wait);
    if (errors.length || data == null) throw errors.length ? explain(errors) : new BlockError("graphql", "Shopify sent an empty answer.");
    return data as T;
  };
  const soft: SoftQuery = async <T,>(query: string, variables?: Record<string, unknown>) => {
    try {
      const { data, errors } = await call(raw, query, variables, wait);
      return { data: data as T | null, error: errors.length ? explain(errors) : null };
    } catch (e) {
      return { data: null, error: e instanceof BlockError ? e : new BlockError("network", "Could not reach Shopify.") };
    }
  };
  return { q, soft };
}

/** The product the merchant is looking at. */
export function selectedProductId(): string | null {
  try {
    const id = shopify.data.selected?.[0]?.id;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

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
