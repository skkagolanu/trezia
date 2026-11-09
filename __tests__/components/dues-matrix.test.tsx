/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import DuesMatrix from '@/components/ui/DuesMatrix';

it('announces the billed amount for paid cells but totals only the unsettled balance', () => {
  const billMap = new Map([
    ['unit-1', new Map([
      ['2026-4', { status: 'PAID', amount: 2_000, outstanding: 0, due_date: '2026-04-10' }],
      ['2026-5', { status: 'OVERDUE', amount: 2_000, outstanding: 1_500, due_date: '2026-05-10' }],
    ])],
  ]);

  render(<DuesMatrix
    units={[{ id: 'unit-1', flat_number: '101' }]}
    billMap={billMap}
    activeFyMonths={[
      { year: 2026, month: 4, label: 'Apr' },
      { year: 2026, month: 5, label: 'May' },
    ]}
    asOn="2026-08-24"
  />);

  expect(screen.getByText('101 · Apr — Paid ₹2,000')).toBeInTheDocument();
  expect(screen.getByText('101 · May — Overdue ₹1,500')).toBeInTheDocument();
  expect(screen.getByText('₹1,500')).toBeInTheDocument();
});
