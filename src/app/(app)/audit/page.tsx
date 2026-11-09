export const metadata = { title: 'Audit Log · Trezia' };

import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/require-auth';
import { hasCapability } from '@/lib/auth/roles';
import { redirect } from 'next/navigation';
import { TableSkeleton } from '@/components/ui/Skeleton';
import Badge from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils/date';
import type { AuditAction } from '@/types/database';
import Link from 'next/link';
import FilterBar from '@/components/ui/FilterBar';
import PageHeader from '@/components/ui/PageHeader';

const PAGE_SIZE = 30;

const ACTION_COLORS: Record<AuditAction, 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple'> = {
  INSERT:            'green',
  UPDATE:            'blue',
  SOFT_DELETE:       'red',
  EXPORT:            'gray',
  LOGIN:             'gray',
  LOGOUT:            'gray',
  RECEIPT_GENERATED: 'blue',
  BILL_GENERATED:    'blue',
};

interface SearchParams {
  page?: string;
  table?: string;
  action?: string;
  from?: string;
  to?: string;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<TableSkeleton />}>
      <AuditContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AuditContent({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const auth = await requireAuth();
  if (auth.unauthorized) redirect('/login');
  if (!hasCapability(auth.role, 'export_audit')) redirect('/access-denied');

  const params = await searchParams;
  const page   = Math.max(1, Number(params.page ?? 1));
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  let query = supabase
    .from('audit_log')
    .select('id, action, table_name, record_id, performed_by, created_at, notes', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (params.table)  query = query.eq('table_name', params.table);
  if (params.action) query = query.eq('action', params.action as AuditAction);
  if (params.from)   query = query.gte('created_at', params.from);
  if (params.to)     query = query.lte('created_at', params.to + 'T23:59:59Z');

  const { data: logs, count } = await query;
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);


  function buildLink(overrides: Record<string, string | undefined>) {
    const merged: Record<string, string> = {};
    if (params.table)  merged.table  = params.table;
    if (params.action) merged.action = params.action;
    if (params.from)   merged.from   = params.from;
    if (params.to)     merged.to     = params.to;
    merged.page = String(page);
    Object.assign(merged, overrides);
    const qs = new URLSearchParams(
      Object.entries(merged).filter(([, v]) => v !== undefined && v !== '') as [string, string][]
    );
    return `/audit?${qs.toString()}`;
  }

  const TABLES = ['payments', 'bills', 'expenditures', 'residents', 'other_income', 'amc_collections', 'levy_configs'];
  const ACTIONS: AuditAction[] = ['INSERT', 'UPDATE', 'SOFT_DELETE', 'EXPORT', 'LOGIN', 'LOGOUT', 'RECEIPT_GENERATED', 'BILL_GENERATED'];

  return (
    <div className="flex flex-col">
      <PageHeader title="Audit Log" count={count} countLabel="events" />

      <div className="flex-1 space-y-3">
        <FilterBar
          fields={[
            { type: 'select' as const, name: 'table', placeholder: 'All tables', options: TABLES.map(t => ({ value: t, label: t })) },
            { type: 'select' as const, name: 'action', placeholder: 'All actions', options: ACTIONS.map(a => ({ value: a, label: a })) },
            { type: 'date' as const, name: 'from' },
            { type: 'date' as const, name: 'to' },
          ]}
        />

        <div className="rounded-xl border border-black/[0.07] bg-sf-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-black/[0.06] text-left">
                  <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">ID</th>
                  <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">When</th>
                  <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Action</th>
                  <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Table</th>
                  <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Record ID</th>
                  <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">By</th>
                  <th className="px-4 py-3 text-[13px] font-semibold text-sf-label2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {logs && logs.length > 0 ? (
                  logs.map(log => (
                    <tr key={log.id} className="hover:bg-sf-bg transition-colors">
                      <td className="px-4 py-3.5 font-mono text-[13px] text-sf-label3">{log.id}</td>
                      <td className="px-4 py-3.5 text-sf-label2 whitespace-nowrap">
                        {formatDate(log.created_at)}
                        <span className="block text-[13px] text-sf-label3">
                          {new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge color={ACTION_COLORS[log.action as AuditAction] ?? 'gray'}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[13px] text-sf-label">{log.table_name}</td>
                      <td className="px-4 py-3.5 font-mono text-[13px] text-sf-label2 max-w-[120px] truncate">
                        {log.record_id ?? '—'}
                      </td>
                      <td className="px-4 py-3.5 text-sf-label2">{log.performed_by}</td>
                      <td className="px-4 py-3.5 text-sf-label3">{log.notes ?? ''}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-[14px] text-sf-label3">
                      No audit events found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-black/[0.06] px-4 py-3">
              <p className="text-[13px] text-sf-label2">Page {page} of {totalPages} &mdash; {count} total</p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={buildLink({ page: String(page - 1) })} className="rounded-[10px] border border-black/[0.12] px-3 py-1.5 text-[13px] font-medium text-sf-label2 hover:bg-sf-bg transition-colors">Previous</Link>
                )}
                {page < totalPages && (
                  <Link href={buildLink({ page: String(page + 1) })} className="rounded-[10px] border border-black/[0.12] px-3 py-1.5 text-[13px] font-medium text-sf-label2 hover:bg-sf-bg transition-colors">Next</Link>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="text-[13px] text-sf-label3">
          Audit log is append-only and protected at the database level — no row can be modified or deleted, even by the administrator.
        </p>
      </div>
    </div>
  );
}
