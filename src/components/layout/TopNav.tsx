'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { Menu, X, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useDrawer } from '@/lib/context/DrawerContext';
import { hasCapability, roleHome, type AppRole } from '@/lib/auth/roles';
import { societyFetch, societyPath } from '@/lib/society-path';
import { detachBrowserPushSubscription } from '@/lib/notifications/browser';

function CmdK() {
  function open(e: React.MouseEvent) {
    e.preventDefault();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  }
  return (
    <button
      onClick={open}
      title="Command palette (⌘K)"
      className="hidden md:inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--sf-border)] px-2 text-[var(--text-xs)] text-[var(--sf-label3)] hover:text-[var(--sf-label2)] hover:bg-[var(--sf-nav-hover)] transition-colors"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
      </svg>
      <kbd className="font-sans">⌘K</kbd>
    </button>
  );
}

const ADMIN_NAV = [
  { href: '/payments',      label: 'Payments',      match: ['/payments', '/bills', '/other-income'] },
  { href: '/claims',        label: 'Payment Reviews' },
  { href: '/reports',       label: 'Reports' },
  { href: '/expenses',      label: 'Expenses' },
  { href: '/balance-sheet', label: 'Balance Sheet' },
  { href: '/residents',     label: 'Residents',     match: ['/residents', '/units'] },
  { href: '/operations',    label: 'Operations' },
  { href: '/notices',       label: 'Notices' },
  { href: '/settings',      label: 'Settings',      match: ['/settings', '/export', '/audit', '/balance-snapshots', '/handovers', '/opening-balances', '/fund-ledger', '/advances', '/bank-reconciliation'] },
] as const;

const RESIDENT_NAV = [
  { href: '/my-flat',   label: 'My Flat' },
  { href: '/community', label: 'Community' },
  { href: '/summary',   label: 'Summary' },
  { href: '/operations', label: 'Documents' },
  { href: '/notices',   label: 'Notices' },
] as const;

type AnyNavItem = { href: string; label: string; match?: readonly string[] };

export default function TopNav({
  dateLabel,
  role = 'admin',
  societyName = 'Trezia',
  brandAbbr = 'TZ',
  isDemo = false,
  societySlug = null,
  societies = [],
  platformMode = false,
  isPlatformOwner = false,
}: {
  dateLabel: string;
  role?: AppRole;
  societyName?: string;
  brandAbbr?: string;
  isDemo?: boolean;
  societySlug?: string | null;
  societies?: Array<{ slug: string; name: string; role: AppRole }>;
  platformMode?: boolean;
  isPlatformOwner?: boolean;
}) {
  const pathname       = usePathname();
  const router         = useRouter();
  const { openDrawer, activeRoute } = useDrawer();
  const [open,        setOpen]        = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const restoreMobileDrawerFocusRef = useRef(false);

  const canOperate = hasCapability(role, 'finance_read');
  const canWrite = !isDemo && hasCapability(role, 'finance_write');
  const NAV: readonly AnyNavItem[] = canOperate ? ADMIN_NAV : hasCapability(role, 'published_documents_read') ? RESIDENT_NAV : [];
  const scoped = (path: string) => societyPath(societySlug, path);
  const homeHref = societySlug ? scoped(roleHome(role)) : platformMode ? '/societies' : roleHome(role);
  // Once inside a scoped society, the switcher only swaps between memberships —
  // it never gets a Platform Owner (or anyone with several memberships) back to
  // the overview/creation dashboard. This is that path.
  const showSocietiesLink = platformMode && (isPlatformOwner || societies.length > 1);
  const societiesLinkActive = pathname === '/societies' || pathname.startsWith('/societies/');
  const logicalPath = societySlug && pathname.startsWith(`/s/${societySlug}`)
    ? pathname.slice(`/s/${societySlug}`.length) || '/'
    : pathname;

  useEffect(() => { setOpen(false); setPendingHref(null); }, [pathname]);

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => menuToggleRef.current?.focus());
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (activeRoute !== null || !restoreMobileDrawerFocusRef.current) return;
    const frame = requestAnimationFrame(() => {
      menuToggleRef.current?.focus();
      restoreMobileDrawerFocusRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeRoute]);

  function active(item: AnyNavItem) {
    if (pendingHref) return pendingHref === item.href;
    const prefixes: readonly string[] = item.match ?? [item.href];
    return prefixes.some(p => logicalPath === p || logicalPath.startsWith(p + '/'));
  }

  const linkCls = (isActive: boolean) => [
    'px-3 h-8 flex items-center rounded-[var(--radius-md)] text-[var(--text-base)] font-medium',
    'transition-colors duration-100 no-underline whitespace-nowrap',
    isActive
      ? 'bg-[var(--sf-nav-active)] text-[var(--sf-blue)]'
      : 'text-[var(--sf-label2)] hover:bg-[var(--sf-nav-hover)] hover:text-[var(--sf-label)]',
  ].join(' ');

  async function signOut() {
    // return to the landing page instead of a dead-end /login flow.
    if (isDemo) { router.push('/api/demo/end'); return; }
    await detachBrowserPushSubscription(async endpoint => {
      await societyFetch('/api/notifications/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
    });
    await createClient().auth.signOut();
    router.push('/login');
  }

  async function switchSociety(slug: string) {
    const target = societies.find(society => society.slug === slug);
    await detachBrowserPushSubscription(async endpoint => {
      await societyFetch('/api/notifications/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
    });
    window.location.assign(`/s/${slug}${roleHome(target?.role ?? null)}`);
  }

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-[var(--sf-divider)] bg-[var(--sf-surface)]">
      {/* Main bar */}
      <div className="flex h-[var(--header-height)] items-center gap-1 px-4 md:gap-2 md:px-6">

        {/* Brand */}
        <Link href={homeHref} className="flex items-center gap-2 mr-3 shrink-0 no-underline">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--sf-blue)] shadow-sm">
            <span className="text-[9px] font-bold leading-none text-white">{brandAbbr}</span>
          </div>
          <span className="hidden sm:inline text-[var(--text-md)] font-bold tracking-tight text-[var(--sf-label)]">
            {societyName}
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden xl:flex flex-1 items-center gap-0.5">
          {NAV.map(item => (
            <Link key={item.href} href={scoped(item.href)} onClick={() => setPendingHref(item.href)} className={linkCls(active(item))}>
              {item.label}
            </Link>
          ))}
        </div>

        {/* Desktop actions */}
        <div className="hidden xl:flex items-center gap-2 ml-auto shrink-0">
          {showSocietiesLink && (
            <a
              href="/societies"
              className={[
                'h-8 px-3 flex items-center rounded-[var(--radius-md)] text-[var(--text-xs)] font-medium',
                'transition-colors no-underline whitespace-nowrap',
                societiesLinkActive
                  ? 'bg-[var(--sf-nav-active)] text-[var(--sf-blue)]'
                  : 'border border-[var(--sf-border)] text-[var(--sf-label2)] hover:bg-[var(--sf-nav-hover)]',
              ].join(' ')}
            >
              Societies
            </a>
          )}
          {societies.length > 1 && societySlug && (
            <select
              aria-label="Switch society"
              value={societySlug}
              onChange={event => {
                // Full load, not router.push: the slug reaches this layout as a proxy-set
                // request header, and the client router reuses a layout across navigations
                // inside the same segment — so a soft switch would keep the previous
                // society's role and name in the chrome until the next hard load.
                void switchSociety(event.target.value);
              }}
              className="h-8 max-w-44 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-surface)] px-2 text-[var(--text-xs)] text-[var(--sf-label2)]"
            >
              {societies.map(society => <option key={society.slug} value={society.slug}>{society.name}</option>)}
            </select>
          )}
          {canWrite && (
            <>
              <CmdK />
              <button
                onClick={() => openDrawer('/payments/new')}
                className="h-8 px-3 rounded-[var(--radius-md)] bg-[var(--sf-blue)] text-[var(--text-base)] font-semibold text-white hover:opacity-90 transition-opacity"
              >
                + Payment
              </button>
              <button
                onClick={() => openDrawer('/expenses/new')}
                className="h-8 px-3 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-base)] font-medium text-[var(--sf-label2)] hover:bg-[var(--sf-nav-hover)] transition-colors"
              >
                + Expense
              </button>
            </>
          )}
          <span className="hidden 2xl:inline pl-3 text-[var(--text-xs)] tabular-nums text-[var(--sf-label3)] border-l border-[var(--sf-divider)]">
            {dateLabel}
          </span>
          <button
            onClick={signOut}
            title="Sign out"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--sf-label3)] hover:text-[var(--sf-red)] hover:bg-[color-mix(in_srgb,var(--sf-red)_8%,transparent)] transition-colors"
          >
            <LogOut size={14} />
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          ref={menuToggleRef}
          onClick={() => setOpen(v => !v)}
          aria-label="Toggle navigation"
          aria-expanded={open}
          aria-controls="top-nav-mobile-menu"
          className="xl:hidden ml-auto flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--sf-label2)] hover:bg-[var(--sf-nav-hover)] transition-colors"
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div id="top-nav-mobile-menu" className="xl:hidden border-t border-[var(--sf-divider)] bg-[var(--sf-surface)] px-3 pb-3 pt-2 space-y-0.5">
          {showSocietiesLink && (
            <a
              href="/societies"
              onClick={() => setOpen(false)}
              className={[
                'flex w-full items-center px-3 h-11 rounded-[var(--radius-md)] text-[var(--text-base)] font-medium transition-colors no-underline',
                societiesLinkActive ? 'bg-[var(--sf-nav-active)] text-[var(--sf-blue)]' : 'text-[var(--sf-label2)] hover:bg-[var(--sf-nav-hover)]',
              ].join(' ')}
            >
              Societies
            </a>
          )}
          {NAV.map(item => (
            <Link
              key={item.href}
              href={scoped(item.href)}
              onClick={() => { setOpen(false); setPendingHref(item.href); }}
              className={[
                'flex w-full items-center px-3 h-11 rounded-[var(--radius-md)] text-[var(--text-base)] font-medium transition-colors no-underline',
                active(item) ? 'bg-[var(--sf-nav-active)] text-[var(--sf-blue)]' : 'text-[var(--sf-label2)] hover:bg-[var(--sf-nav-hover)]',
              ].join(' ')}
            >
              {item.label}
            </Link>
          ))}
          {canWrite && (
            <div className="flex gap-2 pt-2 mt-1 border-t border-[var(--sf-divider)]">
              <button
                onClick={() => { restoreMobileDrawerFocusRef.current = true; setOpen(false); requestAnimationFrame(() => { menuToggleRef.current?.focus(); openDrawer('/payments/new'); }); }}
                className="flex-1 h-11 rounded-[var(--radius-md)] bg-[var(--sf-blue)] text-[var(--text-base)] font-semibold text-white hover:opacity-90"
              >
                + Payment
              </button>
              <button
                onClick={() => { restoreMobileDrawerFocusRef.current = true; setOpen(false); requestAnimationFrame(() => { menuToggleRef.current?.focus(); openDrawer('/expenses/new'); }); }}
                className="flex-1 h-11 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-base)] font-medium text-[var(--sf-label2)]"
              >
                + Expense
              </button>
            </div>
          )}
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2.5 px-3 h-11 rounded-[var(--radius-md)] text-[var(--text-base)] font-medium text-[var(--sf-label3)] hover:text-[var(--sf-red)] hover:bg-[color-mix(in_srgb,var(--sf-red)_8%,transparent)] transition-colors"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      )}
    </nav>
  );
}
