// Replaces the blunt 90-day window: keep the newest successful snapshot, every
// daily point for seven days, the newest point in each of the preceding four
// ISO weeks, and the newest point in each of the preceding twelve calendar
// months. Everything else is a prune candidate. Pure and unit-testable — the
// cron decides whether to actually delete (gated by SNAPSHOT_TIERED_PRUNING_ENABLED).

const DAY_MS = 86_400_000;

export interface PrunableObject {
  key: string;
  lastModified: Date;
}

export interface TieredSelection<T> {
  keep: T[];
  prune: T[];
}

/** ISO-8601 week key, e.g. "2026-W29", computed in UTC for determinism. */
export function isoWeekKey(input: Date): string {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of the ISO week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / DAY_MS / 7 + (firstDayNum - 3) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Calendar-month key, e.g. "2026-07", in UTC. */
export function monthKey(input: Date): string {
  return `${input.getUTCFullYear()}-${String(input.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Given a newest-first list, return the newest representative of each bucket,
// in newest-first order (so slicing takes the most recent buckets).
function newestPerBucket<T extends PrunableObject>(objects: T[], keyOf: (d: Date) => string): T[] {
  const seen = new Set<string>();
  const reps: T[] = [];
  for (const object of objects) {
    const bucket = keyOf(object.lastModified);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    reps.push(object);
  }
  return reps;
}

/**
 * Partition snapshots into keep vs prune under the 7-daily / 4-weekly /
 * 12-monthly policy. `keep` and `prune` are both newest-first.
 */
export function selectTieredSnapshots<T extends PrunableObject>(
  objects: T[],
  now: Date = new Date(),
): TieredSelection<T> {
  const sorted = [...objects].sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime() || a.key.localeCompare(b.key),
  );
  if (sorted.length === 0) return { keep: [], prune: [] };

  const keep = new Set<T>();
  keep.add(sorted[0]); // newest successful snapshot is always retained

  const dailyCutoff = now.getTime() - 7 * DAY_MS;
  const older: T[] = [];
  for (const object of sorted) {
    if (object.lastModified.getTime() >= dailyCutoff) keep.add(object);
    else older.push(object);
  }

  // The tiers overlap: a snapshot is retained if it qualifies under ANY tier.
  // Both reps are chosen over the full set of older snapshots, so the newest
  // point in a month is never displaced by an older same-month point.
  newestPerBucket(older, isoWeekKey).slice(0, 4).forEach(object => keep.add(object));
  newestPerBucket(older, monthKey).slice(0, 12).forEach(object => keep.add(object));

  return {
    keep: sorted.filter(object => keep.has(object)),
    prune: sorted.filter(object => !keep.has(object)),
  };
}
