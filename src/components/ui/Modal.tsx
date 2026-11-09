'use client';
import { useEffect, useRef, useCallback, useId, useLayoutEffect, ReactNode } from 'react';
import { X } from 'lucide-react';
import FocusTrap from 'focus-trap-react';
import { useMountedTransition } from '@/lib/hooks/useMountedTransition';

interface Props {
  open:      boolean;
  onClose:   () => void;
  title?:    string;
  children:  ReactNode;
  size?:     'sm' | 'md' | 'lg';
}

const sizeClass = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };
const CLOSE_MS = 90;

export default function Modal({ open, onClose, title, children, size = 'md' }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const { mounted, closing } = useMountedTransition(open, CLOSE_MS);

  // Capture before FocusTrap moves focus into the dialog. Restore explicitly
  // after the exit animation, since the invoking control may be removed first.
  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      const activeElement = document.activeElement;
      restoreFocusRef.current = activeElement instanceof HTMLElement
        && activeElement !== document.body
        && activeElement !== document.documentElement
        ? activeElement
        : null;
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (open || !restoreFocusRef.current) return;
    const target = restoreFocusRef.current;
    const timer = window.setTimeout(() => {
      if (target.isConnected) target.focus();
      restoreFocusRef.current = null;
    }, CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleKey]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      ref={overlayRef}
      className={`modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px]${closing ? ' is-closing' : ''}`}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <FocusTrap
        active={open}
        focusTrapOptions={{
          escapeDeactivates: false,
          allowOutsideClick: true,
          returnFocusOnDeactivate: false,
          fallbackFocus: () => panelRef.current!,
        }}
      >
        <div
          ref={panelRef}
          className={[
            'modal-panel relative flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-[var(--radius-xl)] bg-[var(--sf-surface)]',
            'shadow-[0_24px_64px_rgba(0,0,0,0.20),0_8px_24px_rgba(0,0,0,0.10)]',
            closing ? 'is-closing' : '',
            sizeClass[size],
          ].join(' ')}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : 'Dialog'}
          tabIndex={-1}
        >
          {title && (
            <div className="flex items-center justify-between border-b border-[var(--sf-divider)] px-5 py-3">
              <h2 id={titleId} className="text-[var(--text-md)] font-semibold text-[var(--sf-label)]">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-[var(--sf-label3)] hover:bg-black/[0.07] hover:text-[var(--sf-label)] transition-colors duration-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-blue)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="min-h-0 overflow-y-auto p-5">{children}</div>
        </div>
      </FocusTrap>
    </div>
  );
}
