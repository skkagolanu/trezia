'use client';

import { useEffect, useId, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import FocusTrap from 'focus-trap-react';
import { useDrawer } from '@/lib/context/DrawerContext';
import { useSocietyPath } from '@/lib/hooks/use-society-path';

const NAV_COMMANDS = [
  { id: 'payments',   label: 'Go to Payments',   href: '/payments' },
  { id: 'expenses',   label: 'Go to Expenses',    href: '/expenses' },
  { id: 'balance',    label: 'Go to Balance Sheet', href: '/balance-sheet' },
  { id: 'residents',  label: 'Go to Residents',   href: '/residents' },
  { id: 'reports',    label: 'Go to Reports',     href: '/reports' },
  { id: 'bills',      label: 'Go to Bills',       href: '/payments/bills' },
  { id: 'levies',     label: 'Go to AMC', href: '/payments/levies' },
  { id: 'settings',   label: 'Go to Settings',    href: '/settings' },
  { id: 'audit',      label: 'View Audit Log',    href: '/audit' },
  { id: 'export',     label: 'Export Data',       href: '/export' },
  { id: 'gen-bills',  label: 'Generate Bills',    href: '/bills/generate' },
];

const ICON = {
  lightning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="cmd-icon">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  nav: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="cmd-icon">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const titleId = useId();
  const router = useRouter();
  const scoped = useSocietyPath();
  const { openDrawer } = useDrawer();

  const toggle = useCallback(() => setOpen(o => !o), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    setSearch('');
    action();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pb-4 pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" aria-hidden="true" />

      {/* Panel */}
      <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: false }}>
        <div
          className="relative mx-4 flex max-h-[calc(80dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-[0_24px_64px_rgba(0,0,0,0.20)]"
          onClick={e => e.stopPropagation()}
          style={{ animation: 'modalIn 110ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <h2 id={titleId} className="sr-only">Command palette</h2>
          <Command shouldFilter className="flex min-h-0 flex-1 flex-col">
            {/* Search input */}
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--sf-divider)] px-4 py-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[var(--sf-label3)]">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search commands…"
                autoFocus
              />
              <kbd className="hidden sm:inline-block shrink-0 rounded-[var(--radius-sm)] border border-[var(--sf-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--sf-label3)]">
                ESC
              </kbd>
            </div>

            <Command.List className="min-h-0 overflow-y-auto">
              <Command.Empty>No commands found.</Command.Empty>

              <Command.Group heading="Quick Actions">
                <Command.Item
                  value="record payment"
                  onSelect={() => run(() => openDrawer('/payments/new'))}
                >
                  {ICON.lightning}
                  Record Payment
                </Command.Item>
                <Command.Item
                  value="record expense"
                  onSelect={() => run(() => openDrawer('/expenses/new'))}
                >
                  {ICON.lightning}
                  Record Expense
                </Command.Item>
              </Command.Group>

              <Command.Separator />

              <Command.Group heading="Navigate">
                {NAV_COMMANDS.map(cmd => (
                  <Command.Item
                    key={cmd.id}
                    value={cmd.label}
                    onSelect={() => run(() => router.push(scoped(cmd.href)))}
                  >
                    {ICON.nav}
                    {cmd.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </div>
      </FocusTrap>
    </div>
  );
}
