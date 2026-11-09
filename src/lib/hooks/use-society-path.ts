'use client';

import { usePathname } from 'next/navigation';
import { currentSocietySlug, societyPath } from '@/lib/society-path';

export function useSocietyPath() {
  const pathname = usePathname();
  const slug = currentSocietySlug(pathname);
  return (path: string) => societyPath(slug, path);
}
