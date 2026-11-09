import { useEffect, type RefObject } from 'react';

// Shared click-outside + Escape dismissal for popovers (Tooltip, FyDropdown).
// Keyed on `active` only; the refs are stable mutable containers and onClose is
// a stable setter, so they don't belong in the dependency list.
export function useDismiss(
  active: boolean,
  refs: RefObject<HTMLElement | null>[],
  onClose: () => void,
) {
  useEffect(() => {
    if (!active) return;
    function onOutside(e: MouseEvent | TouchEvent) {
      if (!refs.some(r => r.current?.contains(e.target as Node))) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
