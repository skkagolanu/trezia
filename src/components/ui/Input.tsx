import { InputHTMLAttributes, forwardRef, ReactNode } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?:   string;
  error?:   string;
  hint?:    string;
  tooltip?: ReactNode;
  prefix?:  string;
  suffix?:  string;
}

const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, hint, tooltip, prefix, suffix, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    const hasDeco = !!(prefix || suffix);
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <div className="flex items-center gap-1.5">
            <label htmlFor={inputId} className="text-[var(--text-sm)] font-medium text-[var(--sf-label)]">
              {label}
              {rest.required && (
                <span className="ml-0.5 text-[var(--sf-red)]" aria-hidden="true">*</span>
              )}
            </label>
            {tooltip}
          </div>
        )}
        <div className={hasDeco ? 'relative flex items-center' : undefined}>
          {prefix && (
            <span className="pointer-events-none absolute left-3 text-[var(--text-sm)] text-[var(--sf-label3)] select-none">
              {prefix}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={[
              'block w-full h-9 rounded-[var(--radius-md)] border bg-[var(--sf-surface)]',
              prefix ? 'pl-7 pr-3' : suffix ? 'pl-3 pr-8' : 'px-3',
              /* 16px floor prevents iOS auto-zoom; renders as 15px on desktop via max() */
              'text-[max(16px,var(--text-base))] text-[var(--sf-label)] placeholder:text-[var(--sf-label3)]',
              'transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]',
              error
                ? 'border-[var(--sf-red)]/50 bg-[color-mix(in_srgb,var(--sf-red)_4%,var(--sf-surface))] focus:ring-[var(--sf-red)]'
                : 'border-[var(--sf-border)] hover:border-[color-mix(in_srgb,var(--sf-label)_28%,transparent)]',
              className,
            ].join(' ')}
            {...rest}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-3 text-[var(--text-sm)] text-[var(--sf-label3)] select-none">
              {suffix}
            </span>
          )}
        </div>
        {hint && !error && <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">{hint}</p>}
        {error && <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
export default Input;
