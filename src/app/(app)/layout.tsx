import { Suspense } from 'react';
import { headers } from 'next/headers';
import dynamic from 'next/dynamic';
import TopNav from '@/components/layout/TopNav';
import { DrawerProvider } from '@/lib/context/DrawerContext';
import AppDrawerHost from '@/components/layout/AppDrawerHost';
import SetupChecklist from '@/components/onboarding/SetupChecklist';
import { listUserSocieties, requireAuth } from '@/lib/supabase/require-auth';
import { createClient } from '@/lib/supabase/server';
import { isDemoSession } from '@/lib/demo/session.server';
import { hasCapability, type AppRole } from '@/lib/auth/roles';
import { multiSocietyRoutingEnabled } from '@/lib/features';
import { SocietyRuntimeProvider } from '@/lib/context/SocietyRuntimeContext';
import AppRuntimeProviders from '@/components/layout/AppRuntimeProviders';

// These client-only enhancements remain behind the server-side capability
// checks below, so users who cannot use them do not download their runtime.
const AgentBar = dynamic(() => import('@/components/agent/AgentBar').then(module => module.AgentBar));
const CommandPalette = dynamic(() => import('@/components/layout/CommandPalette'));
const NotificationOptIn = dynamic(() => import('@/components/notifications/NotificationOptIn'));

function monthFYLabel() {
  const now   = new Date();
  const month = now.toLocaleString('en-IN', { month: 'short' });
  const year  = now.getFullYear();
  const fyEnd = now.getMonth() >= 3 ? year + 1 : year;
  return `${month} ${year} · FY ${fyEnd - 1}–${String(fyEnd).slice(2)}`;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const isDemo = await isDemoSession();

  // requireAuth() short-circuits to a fixed demo-admin identity when the
  // demo cookie is set, without touching Supabase (require-auth.ts) — safe
  // to call unconditionally here.
  let role: AppRole = 'resident';
  const auth = await requireAuth();
  if (!auth.unauthorized) role = auth.role;

  const multiSocietyEnabled = multiSocietyRoutingEnabled();
  const requestHeaders = await headers();
  const societySlug = multiSocietyEnabled ? requestHeaders.get('x-society-slug') : null;
  const userContext = multiSocietyEnabled ? await listUserSocieties() : null;
  const currentSociety = userContext?.societies.find(society => society.slug === societySlug);
  if (multiSocietyEnabled && !societySlug) role = 'committee';

  const canWrite = !isDemo && hasCapability(role, 'finance_write') && !auth.unauthorized && auth.societyStatus === 'active';

  const hasAgentCapability = hasCapability(role, 'use_agent');

  // AgentBar renders only when the role has the capability AND the society has
  // enabled it. Demo is a canned identity with no Groq call, so it stays on.
  let agentEnabled = false;
  if (hasAgentCapability && !auth.unauthorized) {
    if (!isDemo) {
      const sb = await createClient();
      const { data: agentConfig } = await sb
        .from('society_config').select('agent_enabled').eq('society_id', auth.societyId).single();
      agentEnabled = !!(agentConfig as { agent_enabled?: boolean } | null)?.agent_enabled;
    }
  }
  const showAgentBar = hasAgentCapability && agentEnabled;

  const societyStatus = auth.societyStatus ?? 'active';

  // Offer notification enrollment to every authenticated role.
  const showNotificationOptIn = !isDemo
    && !auth.unauthorized
    && (role === 'resident' || hasCapability(role, 'finance_read'));

  return (
    <SocietyRuntimeProvider value={{ societySlug, societyStatus, canWrite }}>
    <>
    <AppRuntimeProviders />
    <DrawerProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[var(--radius-md)] focus:bg-[var(--sf-blue)] focus:px-4 focus:py-2 focus:text-[var(--text-sm)] focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <div className="flex min-h-dvh flex-col">
        {isDemo && (
          <div className="flex w-full items-center justify-center gap-3 border-b border-[color-mix(in_srgb,var(--sf-orange)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-orange)_8%,var(--sf-bg))] py-1.5 text-center text-[var(--text-xs)] font-medium text-[var(--sf-orange)]">
            <span>Demo mode · Demo Apartments · no real data</span>
            <a href="/api/demo/end" className="underline underline-offset-2 hover:opacity-80">
              Exit demo
            </a>
          </div>
        )}
        <TopNav
          dateLabel={monthFYLabel()}
          role={role}
          isDemo={isDemo}
          societySlug={societySlug}
          platformMode={multiSocietyEnabled}
          isPlatformOwner={userContext?.isPlatformOwner ?? false}
          societies={userContext?.societies
            .filter(society => society.status === 'active' || userContext.isPlatformOwner)
            .map(society => ({ slug: society.slug, name: society.name, role: society.role })) ?? []}
          societyName={isDemo ? 'Demo Apartments' : currentSociety?.name ?? 'Trezia'}
          brandAbbr={isDemo ? 'SA' : currentSociety?.shortName ?? 'TZ'}
        />
        {societyStatus === 'suspended' && auth.isPlatformOwner && (
          <div role="status" className="border-b border-[color-mix(in_srgb,var(--sf-orange)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-orange)_8%,var(--sf-bg))] px-4 py-2 text-center text-[var(--text-sm)] font-medium text-[var(--sf-orange)]">
            This society is suspended and is open read-only. Financial and configuration changes are blocked; exports and backups remain available.
          </div>
        )}
        {showNotificationOptIn && (
          <div className="flex justify-end border-b border-[var(--sf-divider)] bg-[var(--sf-surface)] px-4 py-2 sm:px-6 lg:px-8 xl:px-10">
            <NotificationOptIn />
          </div>
        )}
        <main id="main-content" className="flex-1 bg-[var(--sf-bg)]">
          {/* Admins (incl. demo, which is an admin identity) get the AgentBar
              pinned at the bottom — so they always need pb-32 to clear it.
              Demo previously used py-3 with no bottom padding, so the fixed
              AgentBar overlapped page content (e.g. the Settings form). */}
          <div className={`px-4 sm:px-6 lg:px-8 xl:px-10 ${isDemo ? 'py-3' : 'py-5'} ${showAgentBar ? 'pb-32' : ''}`}>
            <SetupChecklist role={role} societyId={auth.societyId} societySlug={societySlug} isDemo={isDemo} />
            <Suspense>{children}</Suspense>
          </div>
        </main>
      </div>

      {canWrite && <AppDrawerHost />}
      {showAgentBar && <AgentBar />}
      {!isDemo && hasAgentCapability && <CommandPalette />}
    </DrawerProvider>
    </>
    </SocietyRuntimeProvider>
  );
}
