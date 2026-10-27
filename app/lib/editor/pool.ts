// A small work pool: runs `worker` over the items with at most `concurrency` running at once.
// If one worker throws, no new item is started, the running ones finish, and the first error is thrown.
export async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const lane = async () => {
    while (!failure) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index] as T, index);
      } catch (error) {
        failure = failure ?? { error };
      }
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  if (failure) throw (failure as { error: unknown }).error;
}
