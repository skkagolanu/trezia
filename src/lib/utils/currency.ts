const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
               'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
               'Seventeen','Eighteen','Nineteen'];
const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ones[n];
  return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
}

function threeDigits(n: number): string {
  if (n >= 100)
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
  return twoDigits(n);
}

export function amountInWords(amount: number): string {
  const n = Math.floor(amount);
  if (n === 0) return 'Zero Rupees Only';

  const crore = Math.floor(n / 10_000_000);
  const lakh  = Math.floor((n % 10_000_000) / 100_000);
  const thou  = Math.floor((n % 100_000) / 1_000);
  const rem   = n % 1_000;

  let words = '';
  if (crore) words += threeDigits(crore) + ' Crore ';
  if (lakh)  words += threeDigits(lakh)  + ' Lakh ';
  if (thou)  words += threeDigits(thou)  + ' Thousand ';
  if (rem)   words += threeDigits(rem);

  return words.trim() + ' Rupees Only';
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Helvetica (react-pdf default font) predates the ₹ glyph (U+20B9, 2010) and
// renders it as a garbage character. Use "Rs." in all PDF templates instead.
export function formatPdfINR(amount: number): string {
  return 'Rs.' + new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
