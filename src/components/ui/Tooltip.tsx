'use client';
import { useState, useRef, useEffect, useLayoutEffect, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDismiss } from '@/lib/hooks/useDismiss';

interface Props {
  text: string;
}

const TIP_WIDTH = 240; // matches w-60
const MARGIN = 8;

export default function Tooltip({ text }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState<{ top: number; left: number } | null>(null);
  const id      = useId();
  const btnRef  = useRef<HTMLButtonElement>(null);
  const tipRef  = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [btnRef, tipRef], close);


  const reposition = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    let left = r.right + MARGIN;
    if (left + TIP_WIDTH > window.innerWidth - MARGIN) left = r.left - TIP_WIDTH - MARGIN;
    if (left < MARGIN) left = MARGIN;
    const top = Math.max(MARGIN, Math.min(r.top, window.innerHeight - 140));
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => { if (open) reposition(); }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  return (
    <span className="inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        aria-label="More information"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(o => !o)}
        className={[
          'inline-flex h-4 w-4 items-center justify-center rounded-full',
          'border text-[10px] font-bold leading-none cursor-help',
          'transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--sf-blue)]',
          open
            ? 'border-[var(--sf-blue)] text-[var(--sf-blue)]'
            : 'border-[var(--sf-border)] text-[var(--sf-label3)] hover:border-[var(--sf-blue)] hover:text-[var(--sf-blue)]',
        ].join(' ')}
      >
        ?
      </button>
      {open && pos && createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: TIP_WIDTH }}
          className={[
            'z-[100] rounded-[var(--radius-lg)] border border-[var(--sf-border)]',
            'bg-[var(--sf-surface)] px-3 py-2.5',
            'text-[var(--text-xs)] leading-relaxed text-[var(--sf-label2)]',
            'shadow-[0_4px_16px_rgba(0,0,0,0.12)]',
          ].join(' ')}
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}
