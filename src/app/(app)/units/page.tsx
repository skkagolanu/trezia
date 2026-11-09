import { redirectToSociety } from '@/lib/society-redirect';

export default async function UnitsPage() {
  return redirectToSociety('/residents');
}
