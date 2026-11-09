import { readFileSync } from 'node:fs';

describe('financial reporting data boundaries', () => {
  it('uses the settled bill balance for reports and the balance sheet', () => {
    const sources = [
      readFileSync('src/app/(app)/reports/ReportsContent.tsx', 'utf8'),
      readFileSync('src/app/(app)/balance-sheet/page.tsx', 'utf8'),
    ];
    for (const content of sources) {
      expect(content).toContain('payable_amount, amount_settled, status, due_date');
      expect(content).toContain('amount: outstandingAmount(b)');
    }
    expect(sources[0]).toContain('outstanding: outstandingAmount(b)');
    expect(sources[0]).toContain('<div className="flex flex-wrap items-center gap-2">');
  });

  it('pages every AMC tracker collection with a stable unique tie-breaker', () => {
    const content = readFileSync('src/app/(app)/payments/LeviesView.tsx', 'utf8');

    expect(content.match(/fetchAll</g)).toHaveLength(3);
    expect(content.match(/\.range\(f, t\)/g)).toHaveLength(3);
    expect(content.match(/\.order\('id', \{ ascending: true \}\)/g)).toHaveLength(3);
  });
});
