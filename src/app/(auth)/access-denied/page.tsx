import SignOutButton from '@/components/auth/SignOutButton';

export const metadata = { title: 'Access Denied · Trezia' };

const SECONDARY_BTN_CLS =
  'inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-md)] border border-[var(--sf-border)] text-[var(--text-sm)] font-medium text-[var(--sf-label2)] hover:bg-black/[0.04] transition-colors no-underline';

export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const isSetupFailed = error === 'setup_failed';

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--sf-bg)] px-4">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sf-orange)_12%,transparent)]">
          <svg className="h-6 w-6 text-[var(--sf-orange)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h1 className="text-[var(--text-lg)] font-semibold text-[var(--sf-label)]">Access not set up</h1>
        <p className="text-[var(--text-sm)] text-[var(--sf-label2)]">
          {isSetupFailed
            ? 'Something went wrong finishing your sign-in — sign out and try the link again, or contact your treasurer.'
            : "Your email isn't linked to any flat yet. Request access and your treasurer will approve it."}
        </p>
        <div className="flex items-center justify-center gap-2">
          <a
            href="/request-access"
            className="inline-flex items-center justify-center h-9 px-4 rounded-[var(--radius-md)] bg-[var(--sf-blue)] text-[var(--text-sm)] font-semibold text-white hover:opacity-90 transition-opacity no-underline"
          >
            Request access
          </a>
          <SignOutButton label="Sign out and start over" className={SECONDARY_BTN_CLS} />
        </div>
      </div>
    </div>
  );
}
