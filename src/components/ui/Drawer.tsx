'use client';
import { useEffect, useId, useLayoutEffect, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import FocusTrap from 'focus-trap-react';
import { useMountedTransition } from '@/lib/hooks/useMountedTransition';

interface Props {
  open:     boolean;
  onClose:  () => void;
  title?:   string;
  children: ReactNode;
  width?:   number;
}

const CLOSE_MS = 140;

export default function Drawer({ open, onClose, title, children, width = 480 }: Props) {
  const firstFocusRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const titleId = useId();
  const { mounted, closing } = useMountedTransition(open, CLOSE_MS);

  // Capture before FocusTrap moves focus into the drawer. Its default return
  // target can be BODY when the trigger was conditionally rendered, so restore
  // the original connected element explicitly once the exit animation finishes.
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div
        className={`drawer-backdrop absolute inset-0 bg-black/30 backdrop-blur-[2px]${closing ? ' is-closing' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <FocusTrap
        active={open}
        focusTrapOptions={{
          allowOutsideClick: true,
          escapeDeactivates: false,
          returnFocusOnDeactivate: false,
        }}
      >
        <div
          className={`drawer relative flex h-[100dvh] max-h-[100dvh] flex-col bg-[var(--sf-surface)] shadow-[-24px_0_64px_rgba(0,0,0,0.15)]${closing ? ' is-closing' : ''}`}
          style={{ width: `min(100vw, ${width}px)` }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : 'Drawer'}
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--sf-divider)] px-5">
            {title && (
              <h2 id={titleId} className="text-[var(--text-base)] font-semibold text-[var(--sf-label)]">{title}</h2>
            )}
            <button
              ref={firstFocusRef}
              type="button"
              onClick={onClose}
              className="ml-auto rounded-[var(--radius-sm)] p-1.5 text-[var(--sf-label3)] hover:bg-black/[0.06] hover:text-[var(--sf-label)] transition-colors duration-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sf-blue)]"
              aria-label="Close drawer"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
