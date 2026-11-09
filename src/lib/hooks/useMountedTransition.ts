import { useEffect, useState } from 'react';

// Keeps a component mounted through its exit animation: returns `mounted` (render
// or not) and `closing` (apply the is-closing class). Shared by Modal and Drawer,
// which had this verbatim. Keyed on `open` only — the same intentional dependency
// choice both originals made.
export function useMountedTransition(open: boolean, closeMs: number) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => { setMounted(false); setClosing(false); }, closeMs);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { mounted, closing };
}
