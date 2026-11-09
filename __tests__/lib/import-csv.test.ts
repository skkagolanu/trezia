import { parseCsv, toCsv } from '@/lib/imports/csv';

describe('parseCsv', () => {
  it('parses a simple header + rows', () => {
    const { header, rows } = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(header).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
  });

  it('strips a UTF-8 BOM from the first header cell', () => {
    const { header } = parseCsv('﻿flat_number,name\nA-101,Anita');
    expect(header[0]).toBe('flat_number');
  });

  it('handles quoted fields with embedded commas and newlines', () => {
    const { rows } = parseCsv('a,b\n"x,y","line1\nline2"');
    expect(rows).toEqual([['x,y', 'line1\nline2']]);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const { rows } = parseCsv('a\n"he said ""hi"""');
    expect(rows).toEqual([['he said "hi"']]);
  });

  it('treats CRLF and LF the same', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([['1', '2']]);
  });

  it('drops fully blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n3,4\n').rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('returns empty header for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });

  it('round-trips through toCsv with quoting', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'z"z']]);
    expect(parseCsv(csv).rows).toEqual([['x,y', 'z"z']]);
  });

  it('rejects malformed quoting instead of normalizing it', () => {
    expect(() => parseCsv('a,b\nabc"def,x')).toThrow('Quote in unquoted field');
    expect(() => parseCsv('a,b\n"abc,x')).toThrow('Unterminated quoted field');
    expect(() => parseCsv('a\n"abc"suffix')).toThrow('Unexpected character');
  });

  it('neutralizes spreadsheet formulas only when requested', () => {
    const rows = [['=cmd()', '+1', '-2', '@name', 'safe']];
    expect(toCsv(['a', 'b', 'c', 'd', 'e'], rows)).toContain('=cmd(),+1,-2,@name,safe');
    expect(parseCsv(toCsv(['a', 'b', 'c', 'd', 'e'], rows, { neutralizeFormulas: true })).rows[0])
      .toEqual(["'=cmd()", "'+1", "'-2", "'@name", 'safe']);
    expect(toCsv(['=unsafe'], [['safe']], { neutralizeFormulas: true })).toMatch(/^'=unsafe/);
  });
});
