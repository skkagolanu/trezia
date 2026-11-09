'use client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { ORANGE, TEAL, AXIS_TICK, TOOLTIP_STYLE, GRID_STROKE, GRID_CURSOR, fmtINR, fmtINRShort } from './shared';

export interface LevyPoint {
  label: string;
  collected: number;
  expected: number;
  paidFull: number;
  totalUnits: number;
  pct: number;
}

export default function LevyBarChart({ data }: { data: LevyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
        barSize={14}
      >
        <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
        <XAxis
          type="number"
          tickFormatter={fmtINRShort}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ ...AXIS_TICK, fill: TEAL }}
          axisLine={false}
          tickLine={false}
          width={86}
        />
        <Tooltip
          formatter={(v) => [fmtINR(Number(v) || 0), 'Collected']}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: TEAL, fontWeight: 600, marginBottom: 2 }}
          cursor={{ fill: GRID_CURSOR }}
        />
        <Bar dataKey="collected" radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.pct >= 100 ? TEAL : ORANGE} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
