// 'use client' chart imported directly into ReportsContent.tsx (a Server
// Component) gets bundled into the whole /payments route's client JS — so a
// pure list visit (?type=maintenance) pays for recharts even though it never
// renders a chart. `next/dynamic` splits each into its own chunk, fetched only
// when the Reports section actually mounts. `ssr: false` is not used here —
// it's disallowed inside Server Components — so these still render in the
// initial SSR HTML; only the *chunking* changes, not chart correctness.
import dynamic from 'next/dynamic';
import { ChartSkeleton } from '@/components/ui/Skeleton';

export const CollectionsBarChart = dynamic(() => import('./CollectionsBarChart'), {
  loading: () => <ChartSkeleton />,
});

export const CollVsExpChart = dynamic(() => import('./CollVsExpChart'), {
  loading: () => <ChartSkeleton />,
});

export const ExpenseDonutChart = dynamic(() => import('./ExpenseDonutChart'), {
  loading: () => <ChartSkeleton height={160} />,
});

export const LevyBarChart = dynamic(() => import('./LevyBarChart'), {
  loading: () => <ChartSkeleton />,
});
