'use client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { ORANGE, TEAL, BROWN, AXIS_TICK, TOOLTIP_STYLE, GRID_STROKE, fmtINR, fmtINRShort } from './shared';

export interface CollVsExpPoint {
  month: string;
  collected: number;
  expenses: number;
}

export default function CollVsExpChart({ data }: { data: CollVsExpPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradCollected" x1="0" y1="0" x2="0" y2="1">
            <stop offset="10%" stopColor={TEAL} stopOpacity={0.22} />
            <stop offset="90%" stopColor={TEAL} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="10%" stopColor={ORANGE} stopOpacity={0.20} />
            <stop offset="90%" stopColor={ORANGE} stopOpacity={0.02} />
          </linearGradient>
        </defs>
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
          formatter={(v, name) => [
            fmtINR(Number(v) || 0),
            name === 'collected' ? 'Collections' : 'Expenses',
          ]}
          labelStyle={{ color: TEAL, fontWeight: 600, marginBottom: 2 }}
          contentStyle={TOOLTIP_STYLE}
        />
        <Legend
          formatter={(value: string) => (
            <span style={{ color: BROWN, fontSize: 11 }}>
              {value === 'collected' ? 'Collections' : 'Expenses'}
            </span>
          )}
          iconSize={8}
          wrapperStyle={{ paddingTop: 4, fontSize: 11 }}
        />
        <Area
          type="monotone"
          dataKey="collected"
          stroke={TEAL}
          strokeWidth={2}
          fill="url(#gradCollected)"
          dot={false}
          activeDot={{ r: 4, fill: TEAL }}
        />
        <Area
          type="monotone"
          dataKey="expenses"
          stroke={ORANGE}
          strokeWidth={2}
          fill="url(#gradExpenses)"
          dot={false}
          activeDot={{ r: 4, fill: ORANGE }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
