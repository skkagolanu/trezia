import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { firstRelation } from '@/lib/supabase/first-relation';
import { ReceiptPDF } from '@/lib/pdf/receipt';
import { formatDate } from '@/lib/utils/date';
import React from 'react';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const payment_id = (body as Record<string, unknown>)?.payment_id;
  if (typeof payment_id !== 'string' || !payment_id) {
    return NextResponse.json({ error: 'payment_id required' }, { status: 400 });
  }

  try {
    const { generateAndStoreReceipt } = await import('@/lib/pdf/generate-and-store-receipt');
    const { pdfUrl } = await generateAndStoreReceipt(payment_id, auth.societyId);
    return NextResponse.json({ ok: true, stored: pdfUrl !== null });
  } catch (err) {
    console.error('[pdf/receipt POST]', err);
    return NextResponse.json({ error: 'Failed to generate receipt' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = new URL(request.url);
  const payment_id = searchParams.get('payment_id');
  if (!payment_id) {
    return NextResponse.json({ error: 'payment_id required' }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    const { data: payment } = await supabase
      .from('payments')
      .select(`
        id, receipt_number, amount_paid, payment_mode, payment_date,
        utr_reference, months_covered, months_detail,
        units!payments_unit_same_society(flat_number),
        residents!payments_resident_same_society(full_name)
      `)
      .eq('id', payment_id)
      .eq('society_id', auth.societyId)
      .single();

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const { data: config } = await supabase
      .from('society_config')
      .select('name, registration_number, address, mobile')
      .eq('society_id', auth.societyId)
      .single();

    const unit = firstRelation<{ flat_number: string }>(payment.units);
    const resident = firstRelation<{ full_name: string }>(payment.residents);

    const receiptData = {
      societyName:        config?.name ?? 'Society',
      registrationNumber: config?.registration_number ?? null,
      address:            config?.address ?? null,
      mobile:             config?.mobile ?? null,
      receiptNumber:      payment.receipt_number ?? '',
      receiptDate:        formatDate(payment.payment_date),
      flatNumber:         unit?.flat_number ?? '',
      residentName:       resident?.full_name ?? 'Resident',
      amountPaid:         Number(payment.amount_paid),
      paymentMode:        payment.payment_mode,
      utrReference:       payment.utr_reference ?? null,
      monthsPeriod:       payment.months_detail ?? formatDate(payment.payment_date),
      monthsCovered:      payment.months_covered ?? 1,
    };

    const buffer = await renderToBuffer(React.createElement(ReceiptPDF, { data: receiptData }) as never);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${receiptData.receiptNumber}.pdf"`,
      },
    });
  } catch (err) {
    console.error('[pdf/receipt GET]', err);
    return NextResponse.json({ error: 'Failed to generate receipt' }, { status: 500 });
  }
}
