import { Resend } from 'resend';
import { formatINR } from '@/lib/utils/currency';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com';

function esc(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ReceiptEmailData {
  to: string;
  residentName: string;
  flatNumber: string;
  monthsPeriod: string;
  amountPaid: number;
  receiptNumber: string;
  paymentDate: string;
  paymentMode: string;
  pdfUrl: string | null;
  societyName: string;
  treasurerMobile: string | null;
}

export async function sendReceiptEmail(data: ReceiptEmailData): Promise<void> {
  const subject = `Receipt for ${data.monthsPeriod} — Flat ${data.flatNumber}`;
  const modeLabel = esc(data.paymentMode.replace(/_/g, ' '));
  const pdfLine = data.pdfUrl
    ? `<p><a href="${esc(data.pdfUrl)}" style="background:#1d4ed8;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;">Download Receipt PDF</a></p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:20px">
  <div style="border-bottom:2px solid #1d4ed8;margin-bottom:16px;padding-bottom:12px">
    <h2 style="color:#1d4ed8;margin:0">${esc(data.societyName)}</h2>
  </div>
  <p>Dear ${esc(data.residentName)},</p>
  <p>Payment received for <strong>${esc(data.monthsPeriod)}</strong> maintenance.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold;width:40%">Amount</td>
      <td style="padding:6px 12px">${formatINR(data.amountPaid)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Receipt No.</td>
      <td style="padding:6px 12px;font-family:monospace">${esc(data.receiptNumber)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Date</td>
      <td style="padding:6px 12px">${esc(data.paymentDate)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Mode</td>
      <td style="padding:6px 12px">${modeLabel}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Flat</td>
      <td style="padding:6px 12px">${esc(data.flatNumber)}</td>
    </tr>
  </table>
  ${pdfLine}
  <p style="color:#555;font-size:13px">
    — ${esc(data.societyName)} Treasurer
    ${data.treasurerMobile ? `<br>Mobile: ${esc(data.treasurerMobile)}` : ''}
  </p>
</body>
</html>`;

  await resend.emails.send({ from: FROM, to: data.to, subject, html });
}

export interface CommitteeSummaryEmailData {
  to: string[];
  societyName: string;
  periodLabel: string;
  opening: number | null;
  receipts: number;
  payments: number;
  net: number;
  closing: number | null;
  treasurerMobile: string | null;
}

function fmtOrDash(n: number | null): string {
  return n !== null ? formatINR(n) : 'Not on record';
}

export async function sendCommitteeSummaryEmail(data: CommitteeSummaryEmailData): Promise<void> {
  const subject = `${data.societyName} — Committee Summary, ${data.periodLabel}`;
  const netColor = data.net >= 0 ? '#059669' : '#dc2626';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:20px">
  <div style="border-bottom:2px solid #1d4ed8;margin-bottom:16px;padding-bottom:12px">
    <h2 style="color:#1d4ed8;margin:0">${esc(data.societyName)}</h2>
    <p style="color:#555;margin:4px 0 0">Committee Summary — ${esc(data.periodLabel)}</p>
  </div>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold;width:50%">Opening balance</td>
      <td style="padding:6px 12px">${esc(fmtOrDash(data.opening))}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Receipts</td>
      <td style="padding:6px 12px;color:#059669">${esc(formatINR(data.receipts))}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Payments</td>
      <td style="padding:6px 12px;color:#dc2626">${esc(formatINR(data.payments))}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Net movement</td>
      <td style="padding:6px 12px;font-weight:bold;color:${netColor}">${esc(formatINR(data.net))}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Closing balance</td>
      <td style="padding:6px 12px;font-weight:bold">${esc(fmtOrDash(data.closing))}</td>
    </tr>
  </table>
  <p style="color:#888;font-size:12px">Cash-basis summary — receipts and payments over the stated period. Full statement with category breakdowns is available in the app under Balance Sheet.</p>
  <p style="color:#555;font-size:13px">
    — ${esc(data.societyName)} Treasurer
    ${data.treasurerMobile ? `<br>Mobile: ${esc(data.treasurerMobile)}` : ''}
  </p>
</body>
</html>`;

  await resend.emails.send({ from: FROM, to: data.to, subject, html });
}

export interface BillEmailData {
  to: string;
  residentName: string;
  flatNumber: string;
  billPeriod: string;
  payableAmount: number;
  invoiceNumber: string;
  dueDate: string;
  pdfUrl: string | null;
  societyName: string;
  treasurerMobile: string | null;
}

export async function sendBillEmail(data: BillEmailData): Promise<void> {
  const subject = `Maintenance Bill — ${data.billPeriod} — Flat ${data.flatNumber}`;
  const pdfLine = data.pdfUrl
    ? `<p><a href="${esc(data.pdfUrl)}" style="background:#1d4ed8;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;">Download Invoice PDF</a></p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:20px">
  <div style="border-bottom:2px solid #1d4ed8;margin-bottom:16px;padding-bottom:12px">
    <h2 style="color:#1d4ed8;margin:0">${esc(data.societyName)}</h2>
  </div>
  <p>Dear ${esc(data.residentName)},</p>
  <p>Your maintenance bill for <strong>${esc(data.billPeriod)}</strong> has been generated.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold;width:40%">Invoice No.</td>
      <td style="padding:6px 12px;font-family:monospace">${esc(data.invoiceNumber)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Amount Payable</td>
      <td style="padding:6px 12px;font-weight:bold;color:#dc2626">${formatINR(data.payableAmount)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Due Date</td>
      <td style="padding:6px 12px">${esc(data.dueDate)}</td>
    </tr>
    <tr>
      <td style="padding:6px 12px;background:#f1f5f9;font-weight:bold">Flat</td>
      <td style="padding:6px 12px">${esc(data.flatNumber)}</td>
    </tr>
  </table>
  ${pdfLine}
  <p style="color:#555;font-size:13px">
    — ${esc(data.societyName)} Treasurer
    ${data.treasurerMobile ? `<br>Mobile: ${esc(data.treasurerMobile)}` : ''}
  </p>
</body>
</html>`;

  await resend.emails.send({ from: FROM, to: data.to, subject, html });
}
