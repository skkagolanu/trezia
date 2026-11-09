import { SelectHTMLAttributes, forwardRef, ReactNode } from 'react';

interface Option { value: string; label: string }

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?:       string;
  error?:       string;
  hint?:        string;
  tooltip?:     ReactNode;
  options:      Option[];
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, Props>(
  ({ label, error, hint, tooltip, options, placeholder, className = '', id, ...rest }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
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
        <div className="relative">
          <select
            ref={ref}
            id={inputId}
            className={[
              'block w-full h-9 appearance-none rounded-[var(--radius-md)] border bg-[var(--sf-surface)] pl-3 pr-8',
              'text-[max(16px,var(--text-base))] text-[var(--sf-label)]',
              'transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--sf-blue)]',
              error
                ? 'border-[var(--sf-red)]/50 focus:ring-[var(--sf-red)]'
                : 'border-[var(--sf-border)] hover:border-[color-mix(in_srgb,var(--sf-label)_28%,transparent)]',
              className,
            ].join(' ')}
            {...rest}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {options.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {/* Custom chevron — replaces native arrow removed by appearance-none */}
          <svg
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--sf-label3)]"
            viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="4 6 8 10 12 6" />
          </svg>
        </div>
        {hint && !error && <p className="text-[var(--text-xs)] text-[var(--sf-label2)]">{hint}</p>}
        {error && <p role="alert" className="text-[var(--text-xs)] text-[var(--sf-red)]">{error}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';
export default Select;
