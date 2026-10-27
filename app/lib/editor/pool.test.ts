import { describe, expect, it } from "vitest";
import { runPool } from "./pool";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe("runPool", () => {
  it("never runs more than the limit at once and finishes every item", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      seen.push(n);
      running -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("runs one at a time when the limit is 1, in order", async () => {
    const order: number[] = [];
    await runPool([1, 2, 3], 1, async (n) => {
      await tick();
      order.push(n);
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("stops starting new items after an error and throws the first one", async () => {
    const started: number[] = [];
    await expect(
      runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await tick();
        if (n === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(started.length).toBeLessThan(6);
  });

  it("copes with no items", async () => {
    await runPool([], 3, async () => {});
  });
});
