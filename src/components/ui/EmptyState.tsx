import Link from 'next/link';

interface Props {
  icon: React.ReactNode;
  heading: string;
  body: string;
  /**
   * Optional call to action shown below the message. Pass `href` for a
   * navigation link (rendered as a Next.js `Link`, so it doesn't full-reload)
   * or `onClick` for an in-place action — e.g. opening the drawer that
   * creates the first record. Most empty states are the best place in the
   * app to point someone at the next step, so prefer passing this over
   * leaving the state bare.
   */
  action?: { label: string; href?: string; onClick?: () => void };
}

const actionClassName =
  'mt-5 inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--sf-blue)] px-4 text-[var(--text-sm)] font-semibold text-white no-underline transition-all hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-blue)] focus-visible:ring-offset-2';

export default function EmptyState({ icon, heading, body, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--sf-label3)]/10 text-[var(--sf-label3)]" aria-hidden="true">
        {icon}
      </div>
      <p className="text-[var(--text-base)] font-semibold text-[var(--sf-label)] tracking-tight">
        {heading}
      </p>
      <p className="mt-1.5 text-[var(--text-sm)] text-[var(--sf-label3)] max-w-xs leading-relaxed">
        {body}
      </p>
      {action && (
        action.href ? (
          <Link href={action.href} className={actionClassName}>
            {action.label}
          </Link>
        ) : (
          <button type="button" onClick={action.onClick} className={actionClassName}>
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
