'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { startTransition, useCallback, useRef } from 'react';

export type FilterField =
  | { type: 'text'; name: string; placeholder?: string; widthClass?: string }
  | { type: 'number'; name: string; placeholder?: string; widthClass?: string }
  | { type: 'select'; name: string; placeholder: string; options: { value: string; label: string }[] }
  | { type: 'date'; name: string };

// One filter surface for every list page. Reads the current query string live, so changing
// one field preserves all the others automatically — no hidden <input> fan-out, no full-page
// form submit. Updates the URL on change inside a transition (non-blocking), which the server
// component re-reads. `keep` lists params that must survive a filter change (e.g. `type`, `fy`).
export default function FilterBar({
  fields,
  keep = [],
  className = '',
}: {
  fields: FilterField[];
  keep?: string[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback(
    (name: string, value: string) => {
      const next = new URLSearchParams();
      // Preserve explicitly-kept params (type/fy/period/etc.)
      for (const k of keep) {
        const v = params.get(k);
        if (v) next.set(k, v);
      }
      // Preserve every other active filter field except the one being changed
      for (const f of fields) {
        if (f.name === name) continue;
        const v = params.get(f.name);
        if (v) next.set(f.name, v);
      }
      if (value) next.set(name, value);
      // A filter change always returns to page 1
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
    },
    [router, pathname, params, fields, keep],
  );

  const hasActive = fields.some(f => params.get(f.name));

  const fieldCls =
    'h-8 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface-2)] px-2.5 text-[var(--text-sm)] text-[var(--sf-label)] placeholder:text-[var(--sf-label3)] focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]';

  const clearHref = () => {
    const next = new URLSearchParams();
    for (const k of keep) {
      const v = params.get(k);
      if (v) next.set(k, v);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  const pillLabel = (f: FilterField, val: string) =>
    f.type === 'select' ? (f.options.find(o => o.value === val)?.label ?? val) : val;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
      {fields.map(f => {
        const current = params.get(f.name) ?? '';
        if (f.type === 'text') {
          return (
            <div key={f.name} className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--sf-label3)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="7" cy="7" r="4.5" />
                <path d="m11 11 3 3" />
              </svg>
              <input
                defaultValue={current}
                placeholder={f.placeholder}
                onChange={e => {
                  const v = e.target.value.trim();
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => apply(f.name, v), 400);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    apply(f.name, (e.target as HTMLInputElement).value.trim());
                  }
                }}
                className={`${fieldCls} pl-8 ${f.widthClass ?? 'w-44'}`}
              />
            </div>
          );
        }
        if (f.type === 'number') {
          return (
            <input
              key={f.name}
              type="number"
              inputMode="decimal"
              min="0"
              defaultValue={current}
              placeholder={f.placeholder}
              onChange={e => {
                const v = e.target.value.trim();
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => apply(f.name, v), 400);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  apply(f.name, (e.target as HTMLInputElement).value.trim());
                }
              }}
              className={`${fieldCls} ${f.widthClass ?? 'w-24'}`}
            />
          );
        }
        if (f.type === 'date') {
          return (
            <input
              key={f.name}
              type="date"
              defaultValue={current}
              onChange={e => apply(f.name, e.target.value)}
              className={fieldCls}
            />
          );
        }
        return (
          <div key={f.name} className="relative">
            <select
              value={current}
              onChange={e => apply(f.name, e.target.value)}
              className={`${fieldCls} appearance-none pr-7`}
            >
              <option value="">{f.placeholder}</option>
              {f.options.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[var(--sf-label3)]"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="4 6 8 10 12 6" />
            </svg>
          </div>
        );
      })}
      </div>
      {hasActive && (
        <div className="flex flex-wrap items-center gap-1.5">
          {fields.filter(f => params.get(f.name)).map(f => (
            <button
              key={f.name}
              type="button"
              onClick={() => apply(f.name, '')}
              title="Remove filter"
              className="inline-flex items-center gap-1 h-7 pl-2.5 pr-2 rounded-full bg-[color-mix(in_srgb,var(--sf-blue)_12%,transparent)] text-[var(--text-xs)] font-medium text-[var(--sf-blue)] hover:bg-[color-mix(in_srgb,var(--sf-blue)_22%,transparent)] transition-colors"
            >
              {pillLabel(f, params.get(f.name)!)}
              <span aria-hidden className="text-[13px] leading-none">×</span>
            </button>
          ))}
          <button
            type="button"
            onClick={clearHref}
            className="h-7 px-2 text-[var(--text-xs)] font-medium text-[var(--sf-label2)] hover:text-[var(--sf-label)] hover:underline transition-colors"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
