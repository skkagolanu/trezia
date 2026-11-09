import { parseBankStatementCsv, findCandidateMatches, type MatchCandidate } from '@/lib/utils/bank-reconciliation';

describe('parseBankStatementCsv', () => {
  it('parses a single signed-amount column, ISO dates', () => {
    const csv = 'Date,Description,Amount\n2026-04-05,UPI/John Doe,2000\n2026-04-06,NEFT Electricity,-1500';
    const { rows, skippedLines } = parseBankStatementCsv(csv);
    expect(rows).toEqual([
      { date: '2026-04-05', description: 'UPI/John Doe', amount: 2000 },
      { date: '2026-04-06', description: 'NEFT Electricity', amount: -1500 },
    ]);
    expect(skippedLines).toEqual([]);
  });

  it('parses DD/MM/YYYY dates', () => {
    const csv = 'Date,Description,Amount\n05/04/2026,Test,100';
    const { rows } = parseBankStatementCsv(csv);
    expect(rows[0].date).toBe('2026-04-05');
  });

  it('parses separate debit/credit columns — credit positive, debit negative', () => {
    const csv = 'Date,Description,Debit,Credit\n2026-04-05,Salary,,5000\n2026-04-06,Rent,3000,';
    const { rows } = parseBankStatementCsv(csv);
    expect(rows[0].amount).toBe(5000);
    expect(rows[1].amount).toBe(-3000);
  });

  it('is case-insensitive on headers and accepts "narration" for description', () => {
    const csv = 'DATE,NARRATION,AMOUNT\n2026-04-05,test,100';
    const { rows } = parseBankStatementCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it('skips rows with an unparseable date, missing description, or zero/invalid amount', () => {
    const csv = [
      'Date,Description,Amount',
      'not-a-date,Test,100',
      '2026-04-05,,100',
      '2026-04-05,Test,0',
      '2026-04-05,Test,notanumber',
      '2026-04-05,Valid row,50',
    ].join('\n');
    const { rows, skippedLines } = parseBankStatementCsv(csv);
    expect(rows).toEqual([{ date: '2026-04-05', description: 'Valid row', amount: 50 }]);
    expect(skippedLines).toEqual([2, 3, 4, 5]);
  });

  it('empty input returns no rows and no skipped lines', () => {
    expect(parseBankStatementCsv('')).toEqual({ rows: [], skippedLines: [] });
  });
});

describe('findCandidateMatches', () => {
  const candidates: MatchCandidate[] = [
    { table: 'payments', id: 'p1', date: '2026-04-05', amount: 2000, label: 'Flat 101' },
    { table: 'payments', id: 'p2', date: '2026-04-10', amount: 2000, label: 'Flat 102' },
    { table: 'expenditures', id: 'e1', date: '2026-04-06', amount: 1500, label: 'Electricity' },
  ];

  it('matches on exact amount within the date window, closest date first', () => {
    const line = { date: '2026-04-04', description: 'UPI credit', amount: 2000 };
    const result = findCandidateMatches(line, candidates, 3);
    expect(result.map(r => r.id)).toEqual(['p1']);
  });

  it('excludes candidates outside the date window even with an exact amount match', () => {
    const line = { date: '2026-04-04', description: 'UPI credit', amount: 2000 };
    const result = findCandidateMatches(line, candidates, 0);
    expect(result).toEqual([]);
  });

  it('amount sign is irrelevant to matching — only magnitude matters', () => {
    const line = { date: '2026-04-06', description: 'Debit', amount: -1500 };
    const result = findCandidateMatches(line, candidates, 3);
    expect(result.map(r => r.id)).toEqual(['e1']);
  });

  it('no candidates within tolerance returns an empty array', () => {
    const line = { date: '2026-04-05', description: 'x', amount: 999 };
    expect(findCandidateMatches(line, candidates)).toEqual([]);
  });
});
