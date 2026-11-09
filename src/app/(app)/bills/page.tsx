import { redirectToSociety } from '@/lib/society-redirect';

export default async function BillsPage() {
  return redirectToSociety('/payments/bills');
}
