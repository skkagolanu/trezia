'use client';

import type { PrintLine } from './PrintBalanceSheetButton';

export interface AuditPackData {
  societyName: string;
  fyLabel: string;
  rp: {
    opening: PrintLine;
    receipts: PrintLine[];
    receiptsTotal: string;
    payments: PrintLine[];
    paymentsTotal: string;
    net: string;
    closing: PrintLine;
  };
  ie: {
    income: PrintLine[];
    incomeTotal: string;
    expenditure: PrintLine[];
    expenditureTotal: string;
    surplusOrDeficit: string;
    note: string;
  };
  bs: {
    assets: PrintLine[];
    totalAssets: string;
    equityAndLiabilities: PrintLine[];
    totalEquityAndLiabilities: string;
    note: string;
  };
  defaulters: Array<{ flat: string; resident: string; monthsDue: number; totalDue: string }>;
  levies: Array<{ label: string; expected: string; collected: string; paidFull: string }>;
}

function section(title: string, lines: PrintLine[], total?: PrintLine) {
  const rows = lines.map(l => `<tr><td>${l.label}</td><td class="amt">${l.value}</td></tr>`).join('');
  const totalRow = total ? `<tr class="total"><td>${total.label}</td><td class="amt">${total.value}</td></tr>` : '';
  return `<table><tbody>${rows}${totalRow}</tbody></table>`;
}

// One printable multi-document bundle for a chosen FY. Reuses
// PrintBalanceSheetButton's window.print() pattern — the browser's own
// "Save as PDF" is the export mechanism, consistent with every other
// printable surface in the app (DefaulterSheet, PrintBalanceSheetButton).
// Each document starts on its own printed page via page-break-before.
export default function AuditPackButton({ data }: { data: AuditPackData }) {
  function handlePrint() {
    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    const defaulterRows = data.defaulters
      .map(d => `<tr><td>${d.flat}</td><td>${d.resident}</td><td class="amt">${d.monthsDue}</td><td class="amt">${d.totalDue}</td></tr>`)
      .join('');
    const levyRows = data.levies
      .map(l => `<tr><td>${l.label}</td><td class="amt">${l.expected}</td><td class="amt">${l.collected}</td><td class="amt">${l.paidFull}</td></tr>`)
      .join('');

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Audit Pack — ${data.fyLabel}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 28px; color: #244855; font-size: 13px; max-width: 640px; margin: 0 auto; }
        section { page-break-before: always; padding-top: 4px; }
        section:first-child { page-break-before: auto; }
        h2 { font-size: 17px; font-weight: 700; margin: 0 0 2px; }
        h3 { font-size: 13px; font-weight: 700; margin: 18px 0 4px; text-transform: uppercase; letter-spacing: 0.04em; color: #874F41; }
        p.sub { font-size: 12px; color: #874F41; margin: 0 0 14px; }
        table { width: 100%; border-collapse: collapse; }
        td, th { padding: 5px 8px; border-bottom: 1px solid rgba(144,174,173,0.25); text-align: left; }
        th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #874F41; }
        td.amt, th.amt { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        tr.total td { border-top: 2px solid #90AEAD; border-bottom: none; font-weight: 700; }
        .net { margin: 14px 0; padding: 8px 10px; background: rgba(144,174,173,0.15); border-radius: 6px; font-weight: 700; display: flex; justify-content: space-between; }
        p.note { font-size: 11px; color: #874F41; margin-top: 10px; }
        @media print { body { padding: 0; } }
      </style></head><body>

      <section>
        <h2>${data.societyName} — Audit Pack</h2>
        <p class="sub">${data.fyLabel} &nbsp;·&nbsp; Generated ${date}</p>
        <p class="note" style="margin-top:0">
          Prepared for the statutory annual audit and AGM (Telangana Societies Registration Act 2001 pattern:
          books audited by 31 July, AGM by 30 September, presenting the audited Balance Sheet as on 31 March).
          This bundle contains the Receipts &amp; Payments, Income &amp; Expenditure, and Balance Sheet statements
          the AGM requires, plus supporting Defaulter and AMC registers. It does not replace the Minutes Book,
          Share Register, or other statutory registers maintained separately by the association — consult your
          registered auditor for the exact register mapping in your state.
        </p>
      </section>

      <section>
        <h2>${data.societyName} — Receipts &amp; Payments</h2>
        <p class="sub">${data.fyLabel} &nbsp;·&nbsp; Generated ${date}</p>
        <h3>Opening</h3>${section('', [data.rp.opening])}
        <h3>Receipts</h3>${section('', data.rp.receipts, { label: 'Total Receipts', value: data.rp.receiptsTotal })}
        <h3>Payments</h3>${section('', data.rp.payments, { label: 'Total Payments', value: data.rp.paymentsTotal })}
        <div class="net"><span>Net movement</span><span>${data.rp.net}</span></div>
        <h3>Closing</h3>${section('', [data.rp.closing])}
      </section>

      <section>
        <h2>${data.societyName} — Income &amp; Expenditure</h2>
        <p class="sub">${data.fyLabel} &nbsp;·&nbsp; Generated ${date}</p>
        <h3>Income</h3>${section('', data.ie.income, { label: 'Total Income', value: data.ie.incomeTotal })}
        <h3>Expenditure</h3>${section('', data.ie.expenditure, { label: 'Total Expenditure', value: data.ie.expenditureTotal })}
        <div class="net"><span>Surplus / (Deficit)</span><span>${data.ie.surplusOrDeficit}</span></div>
        <p class="note">${data.ie.note}</p>
      </section>

      <section>
        <h2>${data.societyName} — Balance Sheet</h2>
        <p class="sub">As on the end of ${data.fyLabel} &nbsp;·&nbsp; Generated ${date}</p>
        <h3>Assets</h3>${section('', data.bs.assets, { label: 'Total Assets', value: data.bs.totalAssets })}
        <h3>Equity &amp; Liabilities</h3>${section('', data.bs.equityAndLiabilities, { label: 'Total Equity &amp; Liabilities', value: data.bs.totalEquityAndLiabilities })}
        <p class="note">${data.bs.note}</p>
      </section>

      <section>
        <h2>${data.societyName} — Defaulter Register</h2>
        <p class="sub">All outstanding dues, across all years &nbsp;·&nbsp; Generated ${date}</p>
        <table><thead><tr><th>Flat</th><th>Resident</th><th class="amt">Months Due</th><th class="amt">Total Due</th></tr></thead>
        <tbody>${defaulterRows || '<tr><td colspan="4">No outstanding dues.</td></tr>'}</tbody></table>
      </section>

      <section>
        <h2>${data.societyName} — AMC Register</h2>
        <p class="sub">Lifetime AMC collection &nbsp;·&nbsp; Generated ${date}</p>
        <table><thead><tr><th>AMC year</th><th class="amt">Expected</th><th class="amt">Collected</th><th class="amt">Flats Paid Full</th></tr></thead>
        <tbody>${levyRows || '<tr><td colspan="4">No AMC recorded.</td></tr>'}</tbody></table>
      </section>

    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <button
      onClick={handlePrint}
      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--sf-border)] bg-[var(--sf-bg)] px-3 text-[var(--text-sm)] font-medium text-[var(--sf-label)] hover:bg-black/[0.05] transition-colors"
      title="Print all 5 audit statements for this FY, one after another"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
      </svg>
      Audit Pack
    </button>
  );
}
