// Shared bounded-concurrency helpers.
const DEFAULT_CONCURRENCY = 2;

export async function mapWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export type SettledItem<T, R> =
  | { item: T; ok: true; value: R }
  | { item: T; ok: false; error: string };

export async function settleWithConcurrency<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency = DEFAULT_CONCURRENCY,
): Promise<Array<SettledItem<T, R>>> {
  return mapWithConcurrency(items, async item => {
    try {
      return { item, ok: true, value: await mapper(item) } as const;
    } catch (error) {
      return {
        item,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown snapshot error',
      } as const;
    }
  }, concurrency);
}
