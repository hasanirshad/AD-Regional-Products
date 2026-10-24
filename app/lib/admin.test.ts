import { describe, expect, it, vi } from "vitest";
import {
  AdminError,
  adminGraphql,
  assertNoUserErrors,
  backoffDelay,
  isThrottled,
  pauseForCost,
  type FetchLike,
} from "./admin";

const ok = (body: unknown, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

const noSleep = async () => {};

describe("backoffDelay", () => {
  it("doubles and caps at 16 s (plus jitter)", () => {
    expect(backoffDelay(0, 0)).toBe(1000);
    expect(backoffDelay(1, 0)).toBe(2000);
    expect(backoffDelay(2, 0)).toBe(4000);
    expect(backoffDelay(10, 0)).toBe(16000);
  });
});

describe("isThrottled", () => {
  it("detects THROTTLED", () => {
    expect(isThrottled([{ message: "x", extensions: { code: "THROTTLED" } }])).toBe(true);
    expect(isThrottled([{ message: "x" }])).toBe(false);
    expect(isThrottled(undefined)).toBe(false);
  });
});

describe("pauseForCost", () => {
  it("returns 0 when the bucket has room", () => {
    expect(
      pauseForCost({
        extensions: { cost: { throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 500, restoreRate: 50 } } },
      }),
    ).toBe(0);
  });
  it("waits for the bucket to restore when it is low", () => {
    expect(
      pauseForCost({
        extensions: { cost: { throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 50 } } },
      }),
    ).toBe(1000);
  });
  it("returns 0 when there is no cost info", () => {
    expect(pauseForCost({})).toBe(0);
  });
});

describe("adminGraphql", () => {
  it("returns data on success", async () => {
    const fetcher: FetchLike = vi.fn(async () => ok({ data: { shop: { name: "A" } } }));
    const data = await adminGraphql<{ shop: { name: string } }>("{shop{name}}", {}, { fetcher, sleep: noSleep });
    expect(data.shop.name).toBe("A");
  });

  it("retries on HTTP 429 then succeeds", async () => {
    const fetcher = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(ok({}, 429))
      .mockResolvedValueOnce(ok({ data: { a: 1 } }));
    const sleep = vi.fn(noSleep);
    const data = await adminGraphql<{ a: number }>("q", {}, { fetcher, sleep });
    expect(data.a).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries on THROTTLED errors then succeeds", async () => {
    const fetcher = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(ok({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }))
      .mockResolvedValueOnce(ok({ data: { a: 2 } }));
    const data = await adminGraphql<{ a: number }>("q", {}, { fetcher, sleep: noSleep });
    expect(data.a).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("gives up after max attempts of throttling", async () => {
    const fetcher = vi.fn<FetchLike>(async () => ok({}, 429));
    await expect(
      adminGraphql("q", {}, { fetcher, sleep: noSleep, maxAttempts: 3 }),
    ).rejects.toThrow(/rate limiting/);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("throws the plain GraphQL error messages without retrying", async () => {
    const fetcher = vi.fn<FetchLike>(async () => ok({ errors: [{ message: "Access denied" }] }));
    await expect(adminGraphql("q", {}, { fetcher, sleep: noSleep })).rejects.toThrow("Access denied");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("explains the likely cause when there is no answer (timeout)", async () => {
    const fetcher: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    await expect(
      adminGraphql("q", {}, { fetcher, sleep: noSleep, timeoutMs: 10 }),
    ).rejects.toThrow(/inside the Shopify admin/);
  });

  it("wraps network failures", async () => {
    const fetcher: FetchLike = async () => {
      throw new Error("boom");
    };
    await expect(adminGraphql("q", {}, { fetcher, sleep: noSleep })).rejects.toBeInstanceOf(AdminError);
  });
});

describe("assertNoUserErrors", () => {
  it("passes on empty or missing", () => {
    expect(() => assertNoUserErrors([], "x")).not.toThrow();
    expect(() => assertNoUserErrors(undefined, "x")).not.toThrow();
  });
  it("throws with all messages", () => {
    expect(() => assertNoUserErrors([{ message: "a" }, { message: "b" }], "Saving")).toThrow("Saving: a; b");
  });
});
