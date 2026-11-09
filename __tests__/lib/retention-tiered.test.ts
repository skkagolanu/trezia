import { selectTieredSnapshots, isoWeekKey, monthKey } from '@/lib/snapshots/retention-tiered';

const DAY = 86_400_000;
// Fixed "now": Wed 29 Jul 2026, 12:00 UTC.
const now = new Date('2026-07-29T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const obj = (key: string, date: Date) => ({ key, lastModified: date });

describe('selectTieredSnapshots', () => {
  it('empty input keeps and prunes nothing', () => {
    expect(selectTieredSnapshots([], now)).toEqual({ keep: [], prune: [] });
  });

  it('always keeps the single newest snapshot', () => {
    const only = [obj('a', ago(500 * DAY))];
    const { keep, prune } = selectTieredSnapshots(only, now);
    expect(keep).toHaveLength(1);
    expect(prune).toHaveLength(0);
  });

  it('keeps every daily point within the last seven days', () => {
    const objects = Array.from({ length: 7 }, (_, i) => obj(`d${i}`, ago((i + 0.5) * DAY)));
    const { prune } = selectTieredSnapshots(objects, now);
    expect(prune).toHaveLength(0);
  });

  it('prunes a second snapshot on the same day beyond the daily window only via tiers', () => {
    // Two points on a day ~10 days ago fall into one ISO-week bucket; only the newest is kept.
    const objects = [
      obj('newest', ago(0.5 * DAY)),
      obj('w-late', ago(10 * DAY)),
      obj('w-early', ago(10.5 * DAY)),
    ];
    const { keep, prune } = selectTieredSnapshots(objects, now);
    expect(keep.map(o => o.key)).toContain('w-late');
    expect(prune.map(o => o.key)).toEqual(['w-early']);
  });

  it('keeps the newest point in each of the four preceding ISO weeks, prunes older weeks', () => {
    // One point per week for 8 distinct older weeks (all beyond the 7-day daily window).
    const objects = [obj('newest', ago(0.5 * DAY))];
    for (let w = 2; w <= 9; w++) objects.push(obj(`week-${w}`, ago(w * 7 * DAY)));
    const { keep, prune } = selectTieredSnapshots(objects, now);
    // newest + 4 weekly reps kept; the older 4 weeks fall to the monthly tier,
    // which collapses same-month weeks — so assert the 4 nearest weeks survive.
    expect(keep.map(o => o.key)).toEqual(expect.arrayContaining(['newest', 'week-2', 'week-3', 'week-4', 'week-5']));
    expect(prune.length).toBeGreaterThan(0);
  });

  it('keeps the newest point per calendar month for twelve months and prunes older months', () => {
    // One snapshot per month for 20 months back. With one point per month the
    // weekly reps coincide with the newest months, so exactly the 12 most recent
    // months survive and everything older prunes.
    const objects = [obj('newest', ago(0.5 * DAY))];
    for (let m = 1; m <= 20; m++) objects.push(obj(`month-${m}`, new Date(Date.UTC(2026, 6 - m, 15))));
    const { keep, prune } = selectTieredSnapshots(objects, now);
    const keptMonths = keep.map(o => o.key).filter(k => k.startsWith('month-'));
    expect(keptMonths).toHaveLength(12);
    expect(prune.map(o => o.key).sort()).toEqual(
      ['month-13', 'month-14', 'month-15', 'month-16', 'month-17', 'month-18', 'month-19', 'month-20'],
    );
  });

  it('keep and prune together partition the input with no overlap', () => {
    const objects = [
      obj('a', ago(0.5 * DAY)), obj('b', ago(3 * DAY)), obj('c', ago(20 * DAY)),
      obj('d', ago(200 * DAY)), obj('e', ago(400 * DAY)),
    ];
    const { keep, prune } = selectTieredSnapshots(objects, now);
    const all = [...keep, ...prune].map(o => o.key).sort();
    expect(all).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(new Set(keep).size + new Set(prune).size).toBe(objects.length);
  });
});

describe('isoWeekKey / monthKey', () => {
  it('computes ISO week keys in UTC', () => {
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(new Date('2026-07-29T12:00:00Z'))).toBe('2026-W31');
  });

  it('groups the same ISO week under one key across a day boundary', () => {
    expect(isoWeekKey(new Date('2026-07-27T00:00:00Z'))).toBe(isoWeekKey(new Date('2026-07-29T23:00:00Z')));
  });

  it('computes calendar-month keys in UTC', () => {
    expect(monthKey(new Date('2026-07-29T12:00:00Z'))).toBe('2026-07');
    expect(monthKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01');
  });
});
