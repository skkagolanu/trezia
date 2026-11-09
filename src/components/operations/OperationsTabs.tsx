'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type OperationsTab = 'documents' | 'vendors' | 'assets';

export default function OperationsTabs({ active, resident }: { active: OperationsTab; resident: boolean }) {
  const pathname = usePathname();
  const tabs: Array<{ id: OperationsTab; label: string }> = resident
    ? [{ id: 'documents', label: 'Documents' }]
    : [{ id: 'documents', label: 'Documents' }, { id: 'vendors', label: 'Vendors & AMCs' }, { id: 'assets', label: 'Assets' }];
  return (
    <nav aria-label="Operations sections" className="-mx-1 overflow-x-auto px-1">
      <div className="flex min-w-max gap-1 rounded-[var(--radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-1">
        {tabs.map(tab => (
          <Link key={tab.id} href={`${pathname}?tab=${tab.id}`} aria-current={active === tab.id ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded-[var(--radius-md)] px-4 text-[var(--text-sm)] font-medium no-underline transition-colors ${active === tab.id ? 'bg-[var(--sf-nav-active)] text-[var(--sf-blue)]' : 'text-[var(--sf-label2)] hover:bg-[var(--sf-nav-hover)]'}`}>
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
