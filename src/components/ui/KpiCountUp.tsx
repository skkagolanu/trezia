'use client';
import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}

export default function KpiCountUp({ value, format, duration = 700 }: Props) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const from = display;
    const diff = value - from;

    function step(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + eased * diff));
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    }

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current != null) cancelAnimationFrame(frameRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format ? format(display) : display.toLocaleString('en-IN')}</>;
}
