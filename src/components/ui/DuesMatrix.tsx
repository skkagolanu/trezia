import { formatINR } from '@/lib/utils/currency';
import { isBillDue } from '@/lib/utils/billing';

interface Cell {
  status: string;
  amount: number;
  outstanding: number;
  due_date: string;
}

interface MatrixUnit {
  id: string;
  flat_number: string;
}

interface FyMonth {
  year: number;
  month: number;
  label: string;
}

interface Props {
  units: MatrixUnit[];
  billMap: Map<string, Map<string, Cell>>;
  activeFyMonths: FyMonth[];
  asOn: string;
}

function cellBg(cell: Cell | undefined, asOn: string): string {
  if (!cell) return 'rgba(0,0,0,0.07)';
  if (cell.status === 'PAID')    return 'var(--sf-green)';
  if (isBillDue(cell, asOn)) return 'var(--sf-red)';
  return 'var(--sf-purple)';
}

function cellTitle(flat: string, month: string, asOn: string, cell?: Cell): string {
  if (!cell) return `${flat} · ${month} — Not billed`;
  const statusLabel =
    cell.status === 'PAID'    ? 'Paid' :
    isBillDue(cell, asOn) ? 'Overdue' : 'Issued';
  const displayedAmount = cell.status === 'PAID' ? cell.amount : cell.outstanding;
  return `${flat} · ${month} — ${statusLabel} ${formatINR(displayedAmount)}`;
}

export default function DuesMatrix({ units, billMap, activeFyMonths, asOn }: Props) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 px-0.5 text-[var(--text-xs)] text-[var(--sf-label2)]" aria-label="Dues status legend">
        {[
          ['var(--sf-green)', 'Paid'],
          ['var(--sf-red)', 'Overdue'],
          ['var(--sf-purple)', 'Issued'],
          ['rgba(0,0,0,0.07)', 'Not billed'],
        ].map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>
      <div className="max-w-full overflow-x-auto">
      <table style={{ borderCollapse: 'separate', borderSpacing: '1px 0' }}>
        <caption className="sr-only">Dues status by flat and month</caption>
        <thead className="sticky top-0 z-10 bg-[var(--sf-surface)]">
          <tr>
            <th className="pb-1 pr-1.5 text-left text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] w-10">Flat</th>
            {activeFyMonths.map(m => (
              <th
                key={`${m.year}-${m.month}`}
                className="w-4 text-[var(--text-xs)] font-semibold text-[var(--sf-label3)] whitespace-nowrap"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', paddingBottom: '4px', height: '32px' }}
              >
                {m.label}
              </th>
            ))}
            <th className="pb-1 pl-1.5 text-right text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap">Due</th>
          </tr>
        </thead>
        <tbody>
          {units.map(unit => {
            const months = billMap.get(unit.id);
            const totalDue = months
              ? Array.from(months.values())
                  .filter(b => isBillDue(b, asOn))
                  .reduce((s, b) => s + b.outstanding, 0)
              : 0;
            return (
              <tr key={unit.id}>
                <td className="py-px pr-1.5 text-[var(--text-xs)] font-semibold text-[var(--sf-label)] whitespace-nowrap">
                  {unit.flat_number}
                </td>
                {activeFyMonths.map(m => {
                  const mk = `${m.year}-${m.month}`;
                  const cell = months?.get(mk);
                  const description = cellTitle(unit.flat_number, m.label, asOn, cell);
                  return (
                    <td key={mk} className="py-px">
                      <span
                        title={description}
                        className="block h-4 w-4 rounded-sm"
                        style={{ backgroundColor: cellBg(cell, asOn) }}
                      >
                        <span className="sr-only">{description}</span>
                      </span>
                    </td>
                  );
                })}
                <td className="py-px pl-1.5 text-right text-[var(--text-xs)] font-semibold whitespace-nowrap">
                  {totalDue > 0
                    ? <span className="text-sf-red">{formatINR(totalDue)}</span>
                    : <span className="text-[var(--sf-label3)]">✓</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
