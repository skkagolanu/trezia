'use client';

import { useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import type { SetupItem } from './setup-items';

interface Props {
  items: SetupItem[];
  /** Per-society dismissal cookie; stored in the browser for one year. */
  cookieName: string;
}

export default function SetupChecklistPanel({ items, cookieName }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  function dismiss() {
    // A one-year cookie is effectively "until this browser forgets it" — long
    // enough that dismissing it reads as permanent, without needing a
    // separate un-dismiss mechanism the product doesn't have.
    document.cookie = `${cookieName}=1; path=/; max-age=31536000; samesite=lax`;
    setDismissed(true);
  }

  return (
    <Card
      title="Finish setting up your society"
      flush
      className="mb-6"
      action={
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss setup checklist"
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--sf-label3)] transition-colors hover:bg-black/[0.06] hover:text-[var(--sf-label)]"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      }
    >
      <ul className="divide-y divide-[var(--sf-divider)]">
        {items.map(item => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-[var(--text-sm)] font-semibold text-[var(--sf-label)]">
                {item.title}
                {item.severity === 'recommended' && (
                  <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--sf-label3)]">
                    Optional
                  </span>
                )}
              </p>
              <p className="mt-1 text-[var(--text-xs)] text-[var(--sf-label3)]">{item.body}</p>
            </div>
            {item.href ? (
              <Link
                href={item.href}
                className="inline-flex h-8 shrink-0 items-center rounded-[var(--radius-md)] bg-[var(--sf-blue)] px-3.5 text-[var(--text-xs)] font-semibold text-white transition-all hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-blue)] focus-visible:ring-offset-2"
              >
                {item.actionLabel ?? 'Fix now'}
              </Link>
            ) : (
              <span className="shrink-0 rounded-full bg-sf-orange/[0.1] px-3 py-1.5 text-[var(--text-xs)] font-semibold text-sf-orange">
                {item.actionLabel ?? 'Admin action required'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
