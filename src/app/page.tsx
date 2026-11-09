import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Receipt, Wallet, FileText, Users, Sparkles, ArrowRight, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { isDemoSession } from '@/lib/demo/session.server';
import { isAppRole, roleHome } from '@/lib/auth/roles';
import type { Metadata } from 'next';
import { listUserSocieties } from '@/lib/supabase/require-auth';
import { multiSocietyRoutingEnabled } from '@/lib/features';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Trezia — Apartment society maintenance & accounting software',
  description:
    'Maintenance collection, dues tracking, receipts, balance sheet, and a resident portal for Indian housing societies — ₹0 UPI/WhatsApp collection, no ads, no data resale.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Trezia',
    description:
      'Maintenance collection, dues tracking, and accounting for Indian apartment societies.',
    type: 'website',
    url: '/',
    siteName: 'Trezia',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Trezia society accounting software' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Trezia',
    description: 'Maintenance collection, dues tracking, and accounting for Indian apartment societies.',
    images: ['/opengraph-image'],
  },
};

const softwareApplicationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Trezia',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description: 'Apartment society maintenance, dues, receipts, and accounting software.',
  url: SITE_URL,
};

// Two lead features carry the pitch; the three below fill it in. Deliberately
// not a uniform 5-card grid — hierarchy does the scanning work.
const LEAD_FEATURES = [
  {
    icon: Wallet,
    title: 'Dues tracking, ₹0 to collect',
    body: 'A live defaulter list with one-tap WhatsApp and UPI collect links. No payment gateway, no per-transaction fee — you keep every rupee collected.',
  },
  {
    icon: FileText,
    title: 'Balance sheet & audit statements',
    body: 'Receipts & Payments for any period, anchored to recorded balances, plus a one-click audit pack — printable for the AGM.',
  },
];

const MORE_FEATURES = [
  {
    icon: Receipt,
    title: 'Billing & receipts',
    body: 'Monthly bills per flat, payments in four modes, auto-issued PDF receipts.',
  },
  {
    icon: Users,
    title: 'Resident portal',
    body: 'Each flat sees its own dues and history. Community view shows amounts owed — never names or numbers.',
  },
  {
    icon: Sparkles,
    title: 'Ask your books a question',
    body: 'A read-only assistant answers "who hasn\'t paid this month" in plain English.',
  },
];

const STEPS = [
  { n: '1', title: 'Sign in with a magic link', body: 'No password to set up or remember — just your email.' },
  { n: '2', title: 'Record payments & expenses', body: 'Two buttons. Receipts generate themselves as PDFs.' },
  { n: '3', title: 'Share the numbers', body: 'Send receipts, publish dues, print the balance sheet for the AGM.' },
];

const TRUST = [
  'No ads, no data resale — your society’s data stays yours',
  'Messaging is consent-gated, never spam',
  'Every change lands in an immutable audit log',
  'Export all your data any time, as CSV or JSON',
];

// Static fixture rows for the product-frame mock — illustrative, not real data.
const MOCK_ROWS = [
  { flat: 'A-101', name: 'Demo Resident 01', status: 'Paid', due: '₹0' },
  { flat: 'A-204', name: 'Demo Resident 02', status: 'Due', due: '₹2,000' },
  { flat: 'B-102', name: 'Demo Resident 03', status: 'Paid', due: '₹0' },
  { flat: 'B-305', name: 'Demo Resident 04', status: 'Overdue', due: '₹4,000' },
];

export default async function LandingPage() {
  // Skip the real-user redirect check entirely for a visitor already
  if (!(await isDemoSession())) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      if (multiSocietyRoutingEnabled()) {
        const context = await listUserSocieties();
        if (!context || context.societies.length === 0) redirect('/access-denied');
        if (context.isPlatformOwner || context.societies.length > 1) redirect('/societies');
        const society = context.societies[0];
        redirect(`/s/${society.slug}${roleHome(society.role)}`);
      }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      redirect(profile && isAppRole(profile.role) ? roleHome(profile.role) : '/access-denied');
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-sf-bg">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
      />
      <header className="border-b border-black/[0.06]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-sf-blue">
              <span className="text-[16px] font-bold text-white">T</span>
            </div>
            <span className="text-[16px] font-bold tracking-tight text-sf-label">Trezia</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/demo/start"
              className="inline-flex h-11 items-center rounded-[10px] px-4 text-[14px] font-medium text-sf-blue hover:bg-sf-blue/[0.08] transition-colors no-underline"
            >
              Try Demo
            </a>
            <Link
              href="/login"
              className="inline-flex h-11 items-center rounded-[10px] border border-black/[0.12] px-4 text-[14px] font-medium text-sf-label2 hover:bg-black/[0.04] transition-colors no-underline"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-3xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
          <h1 className="text-[32px] font-bold leading-tight text-sf-label sm:text-[42px]">
            Run your society&rsquo;s books without an accountant
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-sf-label2 sm:text-[18px]">
            The simple alternative for small societies — maintenance, dues, receipts, and a
            printable balance sheet, built for the treasurer who isn&rsquo;t a techie.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href="/api/demo/start"
              className="flex items-center gap-2 rounded-[10px] bg-sf-blue px-6 py-3 text-[15px] font-semibold text-white hover:opacity-90 transition-opacity no-underline"
            >
              Try the demo
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </a>
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-[10px] border border-black/[0.12] px-6 py-3 text-[15px] font-semibold text-sf-label2 hover:bg-black/[0.04] transition-colors no-underline"
            >
              Sign in
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {['₹0 UPI & WhatsApp collection', 'No ads, no data resale', 'Built for non-technical treasurers'].map(pill => (
              <span
                key={pill}
                className="rounded-full border border-black/[0.08] bg-sf-surface px-3.5 py-1.5 text-[13px] font-medium text-sf-label2"
              >
                {pill}
              </span>
            ))}
          </div>
        </section>

        {/* Product-frame mock — CSS only, illustrative */}
        <section className="mx-auto mt-14 max-w-4xl px-4 sm:mt-20 sm:px-6">
          <div className="overflow-hidden rounded-[16px] border border-black/[0.10] bg-sf-surface shadow-[0_12px_40px_rgba(0,0,0,0.10)]">
            <div className="flex items-center gap-1.5 border-b border-black/[0.07] bg-black/[0.02] px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-black/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-black/15" />
              <span className="h-2.5 w-2.5 rounded-full bg-black/15" />
              <span className="ml-3 text-[12px] text-sf-label3">Dues · This month</span>
            </div>
            <div className="p-4 sm:p-6">
              <table className="w-full text-left text-[13px] sm:text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.07] text-sf-label3">
                    <th className="pb-2 font-medium">Flat</th>
                    <th className="pb-2 font-medium">Resident</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 text-right font-medium">Owed</th>
                  </tr>
                </thead>
                <tbody className="text-sf-label">
                  {MOCK_ROWS.map(r => (
                    <tr key={r.flat} className="border-b border-black/[0.05] last:border-0">
                      <td className="py-2.5 font-medium">{r.flat}</td>
                      <td className="py-2.5 text-sf-label2">{r.name}</td>
                      <td className="py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${
                            r.status === 'Paid'
                              ? 'bg-sf-green/[0.12] text-sf-green'
                              : r.status === 'Overdue'
                                ? 'bg-sf-red/[0.12] text-sf-red'
                                : 'bg-sf-purple/[0.12] text-sf-purple'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-right tabular-nums text-sf-label2">{r.due}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-2 text-center text-[12px] text-sf-label3">Illustrative — your society&rsquo;s real numbers stay private.</p>
        </section>

        {/* Feature strip — 2 lead + 3 compact */}
        <section className="mx-auto max-w-5xl px-4 pt-20 sm:px-6 sm:pt-28">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {LEAD_FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-[16px] border border-black/[0.07] bg-sf-surface p-6 sm:p-7">
                <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-sf-blue/[0.10]">
                  <Icon className="h-5 w-5 text-sf-blue" strokeWidth={1.8} />
                </div>
                <p className="mt-4 text-[17px] font-semibold text-sf-label">{title}</p>
                <p className="mt-2 text-[14px] leading-relaxed text-sf-label2">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {MORE_FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-[16px] border border-black/[0.07] bg-sf-surface p-5">
                <div className="flex items-center gap-2.5">
                  <Icon className="h-[18px] w-[18px] text-sf-blue" strokeWidth={1.8} />
                  <p className="text-[15px] font-semibold text-sf-label">{title}</p>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-sf-label2">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-5xl px-4 pt-20 sm:px-6 sm:pt-28">
          <h2 className="text-center text-[24px] font-bold text-sf-label sm:text-[28px]">Up and running in an afternoon</h2>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {STEPS.map(({ n, title, body }) => (
              <div key={n}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sf-label text-[14px] font-bold text-white">
                  {n}
                </div>
                <p className="mt-3 text-[16px] font-semibold text-sf-label">{title}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-sf-label2">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust strip */}
        <section className="mx-auto max-w-5xl px-4 pt-20 pb-24 sm:px-6 sm:pt-28">
          <div className="rounded-[20px] border border-black/[0.07] bg-sf-surface p-7 sm:p-9">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="h-5 w-5 text-sf-green" strokeWidth={1.8} />
              <p className="text-[17px] font-semibold text-sf-label">Built to be trusted with money</p>
            </div>
            <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TRUST.map(t => (
                <li key={t} className="flex items-start gap-2 text-[14px] leading-relaxed text-sf-label2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sf-green" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-black/[0.06] py-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 text-[13px] text-sf-label3 sm:flex-row sm:px-6">
          <span>&copy; {new Date().getFullYear()} Trezia</span>
          <div className="flex items-center gap-4">
            <a href="/api/demo/start" className="inline-flex h-11 items-center px-2 hover:text-sf-label2 hover:underline">Try the demo</a>
            <Link href="/privacy" className="inline-flex h-11 items-center px-2 hover:text-sf-label2 hover:underline">Privacy Policy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
