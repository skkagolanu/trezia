import { formatBytes } from '@/lib/utils/bytes';

describe('formatBytes', () => {
  it('formats zero and negatives as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });

  it('formats bytes without decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales to KB/MB/GB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB');
  });
});
