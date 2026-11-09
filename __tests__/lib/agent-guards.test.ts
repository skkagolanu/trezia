import { isDuesRowArray } from '@/lib/utils/agent-guards';

describe('isDuesRowArray', () => {
  it('accepts a well-formed array', () => {
    expect(isDuesRowArray([{ flat: '204', resident: 'X', monthsOverdue: 2, totalDue: 4000 }])).toBe(true);
  });

  it('accepts resident: null', () => {
    expect(isDuesRowArray([{ flat: '204', resident: null, monthsOverdue: 1, totalDue: 2000 }])).toBe(true);
  });

  it('accepts an empty array', () => {
    expect(isDuesRowArray([])).toBe(true);
  });

  it('rejects a non-array', () => {
    expect(isDuesRowArray({ result: 'text' })).toBe(false);
    expect(isDuesRowArray(undefined)).toBe(false);
    expect(isDuesRowArray('rows')).toBe(false);
  });

  it('rejects rows missing required fields', () => {
    expect(isDuesRowArray([{ flat: '204' }])).toBe(false);
    expect(isDuesRowArray([{ flat: '204', monthsOverdue: '2', totalDue: 4000 }])).toBe(false);
    expect(isDuesRowArray([{ flat: 204, monthsOverdue: 2, totalDue: 4000 }])).toBe(false);
  });

  it('rejects null/primitive entries', () => {
    expect(isDuesRowArray([null])).toBe(false);
    expect(isDuesRowArray(['flat'])).toBe(false);
  });
});
