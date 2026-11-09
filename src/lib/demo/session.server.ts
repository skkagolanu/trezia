import { cookies } from 'next/headers';
import { DEMO_COOKIE } from './session';

export async function isDemoSession(): Promise<boolean> {
  const store = await cookies();
  return store.get(DEMO_COOKIE)?.value === '1';
}
