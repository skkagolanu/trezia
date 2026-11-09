interface FyMonth {
  year: number;
  month: number;
  label: string;
}

interface MatrixUnit {
  id: string;
  flat_number: string;
}

interface Props {
  units: MatrixUnit[];
  coverageMap: Map<string, Set<string>>;
  fyMonths: FyMonth[];
}

export default function PaymentCoverageMatrix({ units, coverageMap, fyMonths }: Props) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 px-0.5 text-[var(--text-xs)] text-[var(--sf-label2)]" aria-label="Payment coverage legend">
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="h-3 w-3 rounded-sm bg-[var(--sf-green)]" aria-hidden="true" />
          Payment recorded
        </span>
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className="h-3 w-3 rounded-sm bg-black/[0.07]" aria-hidden="true" />
          No payment on record
        </span>
      </div>
      <div className="max-w-full overflow-x-auto">
      <table style={{ borderCollapse: 'separate', borderSpacing: '1px 0' }}>
        <caption className="sr-only">Payment coverage by flat and month</caption>
        <thead className="sticky top-0 z-10 bg-[var(--sf-surface)]">
          <tr>
            <th className="pb-1 pr-1.5 text-left text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] w-10">Flat</th>
            {fyMonths.map(m => (
              <th
                key={`${m.year}-${m.month}`}
                className="w-4 text-[var(--text-xs)] font-semibold text-[var(--sf-label3)] whitespace-nowrap"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', paddingBottom: '4px', height: '32px' }}
              >
                {m.label}
              </th>
            ))}
            <th className="pb-1 pl-1.5 text-right text-[var(--text-xs)] font-semibold text-[var(--sf-label2)] whitespace-nowrap">Cov.</th>
          </tr>
        </thead>
        <tbody>
          {units.map(unit => {
            const covered = coverageMap.get(unit.id);
            const coveredCount = covered?.size ?? 0;
            return (
              <tr key={unit.id}>
                <td className="py-px pr-1.5 text-[var(--text-xs)] font-semibold text-[var(--sf-label)] whitespace-nowrap">
                  {unit.flat_number}
                </td>
                {fyMonths.map(m => {
                  const key = `${m.year}-${m.month}`;
                  const isPaid = covered?.has(key) ?? false;
                  const description = `${unit.flat_number} · ${m.label} — ${isPaid ? 'Payment recorded' : 'No payment on record'}`;
                  return (
                    <td key={key} className="py-px">
                      <span
                        title={description}
                        className="block h-4 w-4 rounded-sm"
                        style={{ backgroundColor: isPaid ? 'var(--sf-green)' : 'rgba(0,0,0,0.07)' }}
                      >
                        <span className="sr-only">{description}</span>
                      </span>
                    </td>
                  );
                })}
                <td className="py-px pl-1.5 text-right text-[var(--text-xs)] font-semibold whitespace-nowrap">
                  {coveredCount === fyMonths.length
                    ? <span className="text-[var(--sf-label3)]">✓</span>
                    : coveredCount > 0
                      ? <span className="text-[var(--sf-orange)]">{coveredCount}/12</span>
                      : <span className="text-[var(--sf-label3)]">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="mt-2 px-0.5 text-[var(--text-xs)] text-[var(--sf-label3)]">
        Derived from imported payment records. Individual bill tracking started April 2025.
      </p>
    </div>
  );
}
