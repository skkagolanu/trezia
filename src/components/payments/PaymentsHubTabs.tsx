'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSocietyPath } from '@/lib/hooks/use-society-path';

const TABS = [
  { label: 'Payments', href: '/payments' },
  { label: 'Bills',    href: '/bills'    },
  { label: 'Reports',  href: '/reports'  },
] as const;

export default function PaymentsHubTabs() {
  const pathname = usePathname();
  const scoped = useSocietyPath();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <div className="flex gap-1 rounded-[var(--radius-lg)] bg-[rgba(144,174,173,0.12)] p-1">
      {TABS.map(({ label, href }) => {
        const scopedHref = scoped(href);
        const active = isActive(scopedHref);
        return (
          <Link
            key={href}
            href={scopedHref}
            className={[
              'flex-1 flex items-center justify-center h-7 rounded-[var(--radius-md)]',
              'text-[var(--text-sm)] font-medium transition-all duration-150 no-underline',
              active
                ? 'bg-[#FBE9D0] text-[var(--sf-label)] shadow-sm'
                : 'text-[var(--sf-label2)] hover:text-[var(--sf-label)]',
            ].join(' ')}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
