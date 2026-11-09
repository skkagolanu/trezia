// PostgREST caps every response at 1,000 rows regardless of the query. Any
// fetch that can exceed that (payments is already ~2,600 rows all-time) must
// page through with .range() — a single un-paged select silently truncates.
// The builder passed in MUST have a stable ORDER BY (add a unique tie-breaker
// column) or pages can overlap/skip rows.
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; ; i++) {
    const { data, error } = await page(i * pageSize, (i + 1) * pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}
