'use client';

export interface PrintLine {
  label: string;
  value: string;
}

export interface PrintStatement {
  societyName: string;
  periodLabel: string;
  opening: PrintLine;
  receipts: PrintLine[];
  receiptsTotal: string;
  payments: PrintLine[];
  paymentsTotal: string;
  net: string;
  closing: PrintLine;
  position: PrintLine[];
  notes: string[];
}

function section(title: string, lines: PrintLine[], total?: PrintLine) {
  const rows = lines
    .map(l => `<tr><td>${l.label}</td><td class="amt">${l.value}</td></tr>`)
    .join('');
  const totalRow = total
    ? `<tr class="total"><td>${total.label}</td><td class="amt">${total.value}</td></tr>`
    : '';
  return `<h3>${title}</h3><table><tbody>${rows}${totalRow}</tbody></table>`;
}

export default function PrintBalanceSheetButton({ data }: { data: PrintStatement }) {
  function handlePrint() {
    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const notes = data.notes.map(n => `<li>${n}</li>`).join('');

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Balance Sheet — ${data.periodLabel}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 28px; color: #244855; font-size: 13px; max-width: 640px; margin: 0 auto; }
        h2 { font-size: 17px; font-weight: 700; margin: 0 0 2px; }
        h3 { font-size: 13px; font-weight: 700; margin: 18px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; color: #874F41; }
        p.sub { font-size: 12px; color: #874F41; margin: 0 0 14px; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 5px 8px; border-bottom: 1px solid rgba(144,174,173,0.25); }
        td.amt { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        tr.total td { border-top: 2px solid #90AEAD; border-bottom: none; font-weight: 700; }
        .net { margin: 14px 0; padding: 8px 10px; background: rgba(144,174,173,0.15); border-radius: 6px; font-weight: 700; display: flex; justify-content: space-between; }
        ul.notes { margin: 18px 0 0; padding-left: 18px; font-size: 11px; color: #874F41; }
        ul.notes li { margin-bottom: 3px; }
        @media print { body { padding: 0; } }
      </style></head><body>
      <h2>${data.societyName} — Balance Sheet (Receipts &amp; Payments)</h2>
      <p class="sub">Period: ${data.periodLabel} &nbsp;·&nbsp; Generated ${date}</p>
      ${section('Opening', [data.opening])}
      ${section('Receipts', data.receipts, { label: 'Total Receipts', value: data.receiptsTotal })}
      ${section('Payments', data.payments, { label: 'Total Payments', value: data.paymentsTotal })}
      <div class="net"><span>Net movement (receipts − payments)</span><span>${data.net}</span></div>
      ${section('Closing', [data.closing])}
      ${section('Position as on period end', data.position)}
      ${notes ? `<ul class="notes">${notes}</ul>` : ''}
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <button
      onClick={handlePrint}
      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)] px-3 text-[var(--text-sm)] font-medium text-[var(--sf-label)] hover:bg-black/[0.05] transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
      Print
    </button>
  );
}
