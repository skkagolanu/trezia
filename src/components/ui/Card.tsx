import { HTMLAttributes } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  action?: React.ReactNode;
  /**
   * Removes the body's default `p-6` padding so edge-to-edge content (most
   * commonly a `<div className="overflow-x-auto sticky-thead"><table>…`)
   * sits flush against the card border instead of stopping short of it.
   * Defaults to `false`, preserving the padded body for every existing call
   * site.
   */
  flush?: boolean;
  /** Escape hatch for a body padding other than the default `p-6`. Ignored when `flush` is set. */
  bodyClassName?: string;
}

export default function Card({ title, action, flush = false, bodyClassName, children, className = '', ...rest }: Props) {
  return (
    <div
      className={`rounded-2xl border border-black/[0.07] bg-sf-surface ${className}`}
      {...rest}
    >
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4">
          {title && (
            <h3 className="text-[15px] font-semibold text-sf-label">{title}</h3>
          )}
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={bodyClassName ?? (flush ? '' : 'p-6')}>{children}</div>
    </div>
  );
}
