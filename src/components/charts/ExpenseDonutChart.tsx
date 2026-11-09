'use client';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { TEAL, SLATE, SLICE_COLORS, TOOLTIP_STYLE, fmtINR, fmtINRShort } from './shared';

export interface ExpenseSlice {
  label: string;
  total: number;
  /** Precomputed target (built server-side, where the period logic lives) — clicking the slice navigates here. */
  href?: string;
}

export default function ExpenseDonutChart({ data, total }: { data: ExpenseSlice[]; total: number }) {
  const router = useRouter();
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={150}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={42}
            outerRadius={62}
            dataKey="total"
            nameKey="label"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={SLICE_COLORS[i % SLICE_COLORS.length]}
                cursor={d.href ? 'pointer' : undefined}
                onClick={() => { if (d.href) router.push(d.href); }}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, name) => [fmtINR(Number(v) || 0), String(name)]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: TEAL, fontWeight: 600 }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Donut centre total */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        style={{ paddingBottom: 8 }}
      >
        <span className="text-[13px] font-bold" style={{ color: TEAL }}>{fmtINRShort(total)}</span>
        <span className="text-[11px]" style={{ color: SLATE }}>total</span>
      </div>
    </div>
  );
}
