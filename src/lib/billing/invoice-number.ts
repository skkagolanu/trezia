// format must stay byte-identical between manual generation (api/bills/route.ts)
// and automatic monthly generation (auto-generate.ts). Both import this single
// implementation so they cannot drift apart.
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function invoiceNumber(flatNumber: string, year: number, month: number): string {
  const yy = String(year).slice(-2);
  return `${MONTH_ABBR[month - 1]}/${flatNumber.replace(/\s+/g, '')}/${yy}`;
}
