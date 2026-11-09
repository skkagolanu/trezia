export const metadata = { title: 'Offline · Trezia' };

export default function OfflinePage() {
  return (
    <div className="flex h-screen items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-3">
        <h1 className="text-[var(--text-lg)] font-semibold text-[var(--sf-label)]">You&rsquo;re offline</h1>
        <p className="text-[var(--text-sm)] text-[var(--sf-label2)]">
          This page needs a connection to load current data. Money records are never shown from a
          stale cache — reconnect and try again.
        </p>
      </div>
    </div>
  );
}
