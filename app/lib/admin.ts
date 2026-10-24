// Direct API access client (playbook sections 3 and 4, gotchas 2 and 3).
// The browser calls the Admin GraphQL API through App Bridge:
//   fetch("shopify:admin/api/graphql.json")
// - 30 s timeout with a message that explains the usual cause.
// - Retry on HTTP 429 and on THROTTLED errors, exponential backoff.
// - Slows down when the cost bucket is nearly empty.

const ENDPOINT = "shopify:admin/api/graphql.json";
export const TIMEOUT_MS = 30_000;
export const MAX_ATTEMPTS = 5;

export class AdminError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

type GraphQLError = {
  message: string;
  extensions?: { code?: string };
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
};

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

export type AdminOptions = {
  fetcher?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Delay before retry number `attempt` (0-based): 1 s, 2 s, 4 s ... capped at 16 s. */
export function backoffDelay(attempt: number, jitter = Math.random()): number {
  const base = Math.min(1000 * 2 ** attempt, 16_000);
  return Math.round(base + jitter * 250);
}

export function isThrottled(errors: GraphQLError[] | undefined): boolean {
  return Boolean(errors?.some((e) => e.extensions?.code === "THROTTLED"));
}

/**
 * When fewer than `requestedCost` points are left, wait until the bucket has
 * restored enough for the next call. Returns 0 when there is room.
 */
export function pauseForCost(
  res: GraphQLResponse<unknown>,
  nextCost = 100,
): number {
  const status = res.extensions?.cost?.throttleStatus;
  if (!status || status.restoreRate <= 0) return 0;
  if (status.currentlyAvailable >= nextCost) return 0;
  const missing = nextCost - status.currentlyAvailable;
  return Math.ceil((missing / status.restoreRate) * 1000);
}

const NO_ANSWER =
  "No answer from Shopify. Direct API access only works inside the Shopify admin. " +
  "Open the app from Apps in your admin (not in a separate browser tab) and try again.";

export async function adminGraphql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  options: AdminOptions = {},
): Promise<T> {
  const fetcher: FetchLike = options.fetcher ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const last = attempt === maxAttempts - 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let status: number;
    let body: GraphQLResponse<T>;
    try {
      const res = await fetcher(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      status = res.status;
      if (status === 429) {
        if (last) throw new AdminError("Shopify is rate limiting requests. Wait a minute and try again.");
        await sleep(backoffDelay(attempt));
        continue;
      }
      if (!res.ok) {
        throw new AdminError(`Shopify answered with HTTP ${status}.`);
      }
      body = (await res.json()) as GraphQLResponse<T>;
    } catch (err) {
      if (err instanceof AdminError) throw err;
      if ((err as { name?: string })?.name === "AbortError") throw new AdminError(NO_ANSWER);
      throw new AdminError(`Could not reach Shopify: ${(err as Error)?.message ?? String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (isThrottled(body.errors)) {
      if (last) throw new AdminError("Shopify is rate limiting requests. Wait a minute and try again.", body.errors);
      await sleep(backoffDelay(attempt));
      continue;
    }

    if (body.errors?.length) {
      throw new AdminError(body.errors.map((e) => e.message).join("; "), body.errors);
    }
    if (!body.data) throw new AdminError("Shopify returned no data.");

    const wait = pauseForCost(body);
    if (wait > 0) await sleep(wait);
    return body.data;
  }

  throw new AdminError("Shopify did not answer after several tries.");
}

/** Throws with the plain messages when a mutation returns userErrors. */
export function assertNoUserErrors(
  userErrors: { field?: string[] | null; message: string }[] | undefined,
  what: string,
): void {
  if (userErrors && userErrors.length > 0) {
    throw new AdminError(
      `${what}: ${userErrors.map((e) => e.message).join("; ")}`,
      userErrors,
    );
  }
}
