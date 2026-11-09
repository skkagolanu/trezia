import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator, requireFinancialReader } from '@/lib/supabase/require-auth';
import { BillPDF } from '@/lib/pdf/bill';
import { billKey, legacyBillKey, resolveCompatibleObjectUrl, uploadPdf } from '@/lib/storage/r2';
import { sendBillEmail } from '@/lib/email/resend';
import { formatDate, formatMonthYear } from '@/lib/utils/date';
import React from 'react';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = new URL(request.url);
  const bill_id = searchParams.get('bill_id');
  if (!bill_id) {
    return NextResponse.json({ error: 'bill_id required' }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    const { data: bill } = await supabase
      .from('bills')
      .select(`
        id, society_id, invoice_number, invoice_date, due_date,
        bill_period_year, bill_period_month,
        base_amount, cgst_percent, sgst_percent,
        cgst_amount, sgst_amount, payable_amount,
        previous_due, penalty_amount, cheque_dishonour,
        units!bills_unit_same_society(flat_number, flat_area_sqft,
          residents!residents_unit_same_society(full_name, phone, email, notification_channel, consent_given, is_primary)
        )
      `)
      .eq('id', bill_id)
      .eq('society_id', auth.societyId)
      .single();

    if (!bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }

    const { data: config } = await supabase
      .from('society_config')
      .select('name, registration_number, address, mobile, gstin, pan_number')
      .eq('society_id', auth.societyId)
      .single();
    const unit = bill.units as unknown as {
      flat_number: string;
      flat_area_sqft: number | null;
      residents: { full_name: string; phone: string | null; email: string | null; notification_channel: string; consent_given: boolean; is_primary: boolean }[] | null;
    } | null;

    const primaryResident = Array.isArray(unit?.residents)
      ? unit.residents.find(r => r.is_primary) ?? unit.residents[0] ?? null
      : null;

    const billData = {
      societyName:        config?.name ?? 'Society',
      registrationNumber: config?.registration_number ?? null,
      address:            config?.address ?? null,
      mobile:             config?.mobile ?? null,
      gstin:              config?.gstin ?? null,
      panNumber:          config?.pan_number ?? null,
      invoiceNumber:      bill.invoice_number,
      invoiceDate:        formatDate(bill.invoice_date),
      dueDate:            formatDate(bill.due_date),
      flatNumber:         unit?.flat_number ?? '',
      residentName:       primaryResident?.full_name ?? 'Resident',
      residentPhone:      primaryResident?.phone ?? null,
      residentEmail:      primaryResident?.email ?? null,
      flatAreaSqft:       unit?.flat_area_sqft ?? null,
      baseAmount:         Number(bill.base_amount),
      cgstPercent:        Number(bill.cgst_percent),
      sgstPercent:        Number(bill.sgst_percent),
      cgstAmount:         Number(bill.cgst_amount),
      sgstAmount:         Number(bill.sgst_amount),
      previousDue:        Number(bill.previous_due),
      penaltyAmount:      Number(bill.penalty_amount),
      chequeDishonour:    Number(bill.cheque_dishonour),
      payableAmount:      Number(bill.payable_amount),
      billPeriod:         formatMonthYear(bill.bill_period_year, bill.bill_period_month),
    };

    const buffer = await renderToBuffer(React.createElement(BillPDF, { data: billData }) as never);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${bill.invoice_number}.pdf"`,
      },
    });
  } catch (err) {
    console.error('[pdf/bill GET]', err);
    return NextResponse.json({ error: 'Failed to generate bill PDF' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  try {
    const { bill_id, send_email } = await request.json() as { bill_id?: string; send_email?: boolean };
    if (!bill_id) {
      return NextResponse.json({ error: 'bill_id required' }, { status: 400 });
    }

    const supabase = await createClient();

    const { data: bill } = await supabase
      .from('bills')
      .select(`
        id, society_id, invoice_number, invoice_date, due_date,
        bill_period_year, bill_period_month,
        base_amount, cgst_percent, sgst_percent,
        cgst_amount, sgst_amount, payable_amount,
        previous_due, penalty_amount, cheque_dishonour,
        units!bills_unit_same_society(flat_number, flat_area_sqft,
          residents!residents_unit_same_society(full_name, phone, email, notification_channel, consent_given, is_primary)
        )
      `)
      .eq('id', bill_id)
      .eq('society_id', auth.societyId)
      .single();

    if (!bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }

    const { data: config } = await supabase
      .from('society_config')
      .select('name, registration_number, address, mobile, gstin, pan_number')
      .eq('society_id', auth.societyId)
      .single();

    const unit = bill.units as unknown as {
      flat_number: string;
      flat_area_sqft: number | null;
      residents: { full_name: string; phone: string | null; email: string | null; notification_channel: string; consent_given: boolean; is_primary: boolean }[] | null;
    } | null;

    const primaryResident = Array.isArray(unit?.residents)
      ? unit.residents.find(r => r.is_primary) ?? unit.residents[0] ?? null
      : null;

    const billData = {
      societyName:        config?.name ?? 'Society',
      registrationNumber: config?.registration_number ?? null,
      address:            config?.address ?? null,
      mobile:             config?.mobile ?? null,
      gstin:              config?.gstin ?? null,
      panNumber:          config?.pan_number ?? null,
      invoiceNumber:      bill.invoice_number,
      invoiceDate:        formatDate(bill.invoice_date),
      dueDate:            formatDate(bill.due_date),
      flatNumber:         unit?.flat_number ?? '',
      residentName:       primaryResident?.full_name ?? 'Resident',
      residentPhone:      primaryResident?.phone ?? null,
      residentEmail:      primaryResident?.email ?? null,
      flatAreaSqft:       unit?.flat_area_sqft ?? null,
      baseAmount:         Number(bill.base_amount),
      cgstPercent:        Number(bill.cgst_percent),
      sgstPercent:        Number(bill.sgst_percent),
      cgstAmount:         Number(bill.cgst_amount),
      sgstAmount:         Number(bill.sgst_amount),
      previousDue:        Number(bill.previous_due),
      penaltyAmount:      Number(bill.penalty_amount),
      chequeDishonour:    Number(bill.cheque_dishonour),
      payableAmount:      Number(bill.payable_amount),
      billPeriod:         formatMonthYear(bill.bill_period_year, bill.bill_period_month),
    };

    const buffer = await renderToBuffer(React.createElement(BillPDF, { data: billData }) as never);

    const { data: societyForStorage } = await supabase
      .from('societies')
      .select('legacy_storage_layout')
      .eq('id', auth.societyId)
      .single();
    let pdfUrl: string | null = null;
    if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
      const key = billKey(auth.societyId, bill.invoice_number);
      pdfUrl = await resolveCompatibleObjectUrl({
        societyId: auth.societyId,
        legacyStorageLayout: societyForStorage?.legacy_storage_layout ?? null,
        scopedKey: key,
        legacyKey: legacyBillKey(bill.invoice_number),
      }) ?? await uploadPdf(key, Buffer.from(buffer));
    }

    // Optionally send email
    if (send_email && primaryResident?.email && primaryResident.consent_given === true && primaryResident.notification_channel !== 'NONE') {
      try {
        await sendBillEmail({
          to:              primaryResident.email,
          residentName:    primaryResident.full_name ?? 'Resident',
          flatNumber:      unit?.flat_number ?? '',
          billPeriod:      billData.billPeriod,
          payableAmount:   billData.payableAmount,
          invoiceNumber:   bill.invoice_number,
          dueDate:         billData.dueDate,
          // Private objects are available only through the authenticated PDF route.
          pdfUrl: null,
          societyName:     billData.societyName,
          treasurerMobile: config?.mobile ?? null,
        });
      } catch {
        // Email failure is non-fatal
      }
    }

    return NextResponse.json({ ok: true, stored: pdfUrl !== null });
  } catch (err) {
    console.error('[pdf/bill POST]', err);
    return NextResponse.json({ error: 'Failed to generate bill PDF' }, { status: 500 });
  }
}
