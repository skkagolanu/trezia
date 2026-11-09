'use client';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { TEAL, AXIS_TICK, TOOLTIP_STYLE, GRID_STROKE, GRID_CURSOR, fmtINR, fmtINRShort } from './shared';

export interface CollectionPoint {
  month: string;
  collected: number;
  payment_count: number;
  /** Precomputed target (built server-side, where the period logic lives) — clicking the bar navigates here. */
  href?: string;
}

export default function CollectionsBarChart({ data }: { data: CollectionPoint[] }) {
  const router = useRouter();
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barSize={22}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} />
        <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={fmtINRShort}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={54}
        />
        <Tooltip
          formatter={(v) => [fmtINR(Number(v) || 0), 'Collected']}
          labelStyle={{ color: TEAL, fontWeight: 600, marginBottom: 2 }}
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: GRID_CURSOR }}
        />
        <Bar
          dataKey="collected"
          fill={TEAL}
          radius={[4, 4, 0, 0]}
          cursor="pointer"
          onClick={(bar: { payload?: CollectionPoint }) => {
            const href = bar?.payload?.href;
            if (href) router.push(href);
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
