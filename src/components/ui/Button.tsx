'use client';
import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size    = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  Variant;
  size?:     Size;
  loading?:  boolean;
  isLoading?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary:   'bg-[var(--sf-blue)] text-white hover:opacity-90 disabled:opacity-50 shadow-sm',
  secondary: 'bg-black/[0.06] text-[var(--sf-label)] hover:bg-black/[0.10] disabled:opacity-50',
  danger:    'bg-[var(--sf-red)] text-white hover:opacity-90 disabled:opacity-50 shadow-sm',
  ghost:     'bg-transparent text-[var(--sf-blue)] hover:bg-[color-mix(in_srgb,var(--sf-blue)_10%,transparent)] disabled:opacity-50',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-7 px-3 text-[var(--text-xs)]',
  md: 'h-9 px-4 text-[var(--text-sm)]',
  lg: 'h-10 px-5 text-[var(--text-base)]',
};

const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', loading, isLoading, children, className = '', disabled, ...rest }, ref) => {
    const busy = loading || isLoading;
    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        className={[
          'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium',
          'transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-blue)] focus-visible:ring-offset-2',
          variantClass[variant],
          sizeClass[size],
          className,
        ].join(' ')}
        {...rest}
      >
        {busy && (
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
export default Button;
