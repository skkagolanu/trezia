'use client';

import { useRef } from 'react';
import type { DuesSummary } from '@/types/database';
import { buildCollectMessage, buildUpiLink, buildWhatsAppLink } from '@/lib/utils/collect-request';
import { usePathname } from 'next/navigation';
import { societyApiPath } from '@/lib/society-path';

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export default function DefaulterSheet({
  dues,
  societyName,
  upiVpa,
}: {
  dues: DuesSummary[];
  societyName: string;
  upiVpa: string | null;
}) {
  const pathname = usePathname();
  const printRef = useRef<HTMLDivElement>(null);
  const defaulters = dues
    .filter(d => (d.unpaid_months ?? 0) > 0)
    .sort((a, b) => (b.unpaid_months ?? 0) - (a.unpaid_months ?? 0));

  function handlePrint() {
    const content = printRef.current?.innerHTML ?? '';
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`
      <html><head><title>Defaulter Contact Sheet</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; color: #244855; }
        h2 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
        p.sub { font-size: 13px; color: #874F41; margin-top: 0; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px 10px; background: rgba(144,174,173,0.2); border-bottom: 2px solid #90AEAD; font-weight: 600; }
        td { padding: 8px 10px; border-bottom: 1px solid rgba(144,174,173,0.25); }
        .due { color: #E64833; font-weight: 600; }
        .months { font-weight: 600; }
        @media print { body { padding: 0; } }
      </style></head><body>${content}</body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="rounded-2xl border border-black/[0.07] bg-sf-surface">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4">
        <div>
          <h3 className="text-[15px] font-semibold text-sf-label">Defaulters — All Outstanding Dues</h3>
          <p className="mt-0.5 text-[12px] text-sf-label3">Across all years (not limited to the selected FY) — {defaulters.length} flat{defaulters.length !== 1 ? 's' : ''} with outstanding dues</p>
        </div>
        {defaulters.length > 0 && (
          <div className="flex items-center gap-2">
            <a
              href={societyApiPath(pathname, '/api/pdf/dues-notice?all=1')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-sf-blue/[0.4] bg-sf-blue/[0.06] px-3 py-1.5 text-[13px] font-medium text-sf-blue hover:bg-sf-blue/[0.12] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              Print all notices
            </a>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-black/[0.12] bg-sf-bg px-3 py-1.5 text-[13px] font-medium text-sf-label hover:bg-black/[0.05] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print contact sheet
            </button>
          </div>
        )}
      </div>

      <div className="p-6">
        {defaulters.length === 0 ? (
          <p className="text-center text-[14px] text-sf-label3 py-4">No outstanding dues — all flats are paid up.</p>
        ) : (
          <div>
            {/* Hidden — innerHTML captured for the print popup only, never shown in-page */}
            <div ref={printRef} className="hidden">
              <h2>Defaulters — All Outstanding Dues</h2>
              <p className="sub">Generated {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · across all years · {defaulters.length} flat{defaulters.length !== 1 ? 's' : ''} with outstanding dues</p>
              <table>
                <thead>
                  <tr>
                    <th>Flat</th>
                    <th>Resident</th>
                    <th>Phone</th>
                    <th>Months Due</th>
                    <th>Total Due</th>
                  </tr>
                </thead>
                <tbody>
                  {defaulters.map((d, i) => (
                    <tr key={i}>
                      <td><strong>{d.flat_number}</strong></td>
                      <td>{d.primary_resident ?? '—'}</td>
                      <td>{d.phone ?? '—'}</td>
                      <td className="months">{d.unpaid_months ?? 0}</td>
                      <td className="due">{formatINR(Number(d.total_due ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Screen view */}
            <div className="overflow-x-auto mt-0">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left">
                    <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">Flat</th>
                    <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">Resident</th>
                    <th className="pb-2.5 text-[13px] font-semibold text-sf-label2">Phone</th>
                    <th className="pb-2.5 text-[13px] font-semibold text-sf-label2 text-right">Months Due</th>
                    <th className="pb-2.5 text-[13px] font-semibold text-sf-label2 text-right">Total Due</th>
                    <th className="pb-2.5 text-[13px] font-semibold text-sf-label2 text-right">Collect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04]">
                  {defaulters.map((d, i) => {
                    const amount = Number(d.total_due ?? 0);
                    const message = buildCollectMessage({
                      societyName,
                      flatNumber: d.flat_number,
                      residentName: d.primary_resident,
                      amount,
                      monthsOwed: d.unpaid_months ?? 0,
                    });
                    const waLink = d.phone ? buildWhatsAppLink(d.phone, message) : null;
                    const upiLink = buildUpiLink({ vpa: upiVpa, payeeName: societyName, amount, note: `Flat ${d.flat_number} maintenance` });
                    return (
                      <tr key={i} className="hover:bg-sf-bg">
                        <td className="py-3 font-semibold text-sf-label">{d.flat_number}</td>
                        <td className="py-3 text-sf-label2">{d.primary_resident ?? '—'}</td>
                        <td className="py-3">
                          {d.phone ? (
                            <a href={`tel:${d.phone}`} className="text-sf-blue hover:underline text-[14px]">{d.phone}</a>
                          ) : (
                            <span className="text-sf-label3">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right font-semibold text-sf-label">{d.unpaid_months ?? 0}</td>
                        <td className="py-3 text-right font-bold text-sf-red">
                          {formatINR(amount)}
                        </td>
                        <td className="py-3 text-right whitespace-nowrap">
                          <a
                            href={societyApiPath(pathname, `/api/pdf/dues-notice?flat=${encodeURIComponent(d.flat_number)}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sf-blue hover:underline text-[13px] font-medium"
                          >
                            Notice
                          </a>
                          {waLink && (
                            <>
                              <span className="mx-1.5 text-sf-label3">·</span>
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sf-green hover:underline text-[13px] font-medium"
                                title="Send a WhatsApp collect-request message"
                              >
                                WhatsApp
                              </a>
                            </>
                          )}
                          {upiLink && (
                            <>
                              <span className="mx-1.5 text-sf-label3">·</span>
                              <a
                                href={upiLink}
                                className="text-sf-blue hover:underline text-[13px] font-medium"
                                title="Open a UPI app to record payment against this dues amount"
                              >
                                UPI
                              </a>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
