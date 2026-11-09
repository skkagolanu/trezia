'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { useDismiss } from '@/lib/hooks/useDismiss';

export interface FyDropdownOption {
  value: string;
  label: string;
  href: string;
  isActive: boolean;
}

// Keep the financial-year selector on one row.
export default function FyDropdown({
  options,
  label,
  isActive,
}: {
  options: FyDropdownOption[];
  label: string;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [rootRef], close);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={[
          'flex h-8 items-center gap-1 rounded-[var(--radius-md)] px-3 text-[var(--text-sm)] font-medium transition-all',
          isActive
            ? 'bg-[var(--sf-label)] text-white'
            : 'border border-[var(--sf-border)] text-[var(--sf-label3)] hover:text-[var(--sf-label2)] hover:bg-[rgba(144,174,173,0.08)]',
        ].join(' ')}
      >
        {label}
        <svg
          width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-[calc(100%+4px)] z-50 max-h-64 w-40 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-1 shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
        >
          {options.map(o => (
            <Link
              key={o.value}
              href={o.href}
              onClick={() => setOpen(false)}
              className={[
                'block rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-sm)] font-medium no-underline transition-colors',
                o.isActive
                  ? 'bg-[var(--sf-label)] text-white'
                  : 'text-[var(--sf-label2)] hover:bg-[rgba(144,174,173,0.12)]',
              ].join(' ')}
            >
              {o.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
