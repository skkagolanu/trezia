import { redirectToSociety } from '@/lib/society-redirect';

export default async function OtherIncomePage() {
  return redirectToSociety('/payments/other-income');
}
