import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialReader } from '@/lib/supabase/require-auth';
import { firstRelation } from '@/lib/supabase/first-relation';
import { ReceiptPDF } from '@/lib/pdf/receipt';
import { formatDate } from '@/lib/utils/date';
import { labelDisplay } from '@/lib/utils/levy-label';
import React from 'react';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    const [{ data: collection }, { data: config }] = await Promise.all([
      supabase
        .from('amc_collections')
        .select('id, levy_label, amount_paid, payment_date, payment_mode, is_voided, units!amc_unit_same_society(flat_number, residents!residents_unit_same_society(full_name, is_primary, is_active, phone))')
        .eq('id', id)
        .eq('society_id', auth.societyId)
        .single(),
      supabase
        .from('society_config')
        .select('name, registration_number, address, mobile')
        .eq('society_id', auth.societyId)
        .single(),
    ]);

    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }
    if (collection.is_voided) {
      return NextResponse.json({ error: 'Collection is voided' }, { status: 410 });
    }

    const unit = firstRelation<{
      flat_number: string;
      residents: Array<{ full_name: string; is_primary: boolean; is_active: boolean; phone: string | null }>;
    }>(collection.units);

    const residents = unit?.residents ?? [];
    const primary = residents.find(r => r.is_primary && r.is_active) ?? residents[0];

    const receiptData = {
      societyName:        config?.name ?? 'Society',
      registrationNumber: config?.registration_number ?? null,
      address:            config?.address ?? null,
      mobile:             config?.mobile ?? null,
      receiptNumber:      `LEV-${id.slice(0, 8).toUpperCase()}`,
      receiptDate:        formatDate(collection.payment_date ?? new Date().toISOString().slice(0, 10)),
      flatNumber:         unit?.flat_number ?? '',
      residentName:       primary?.full_name ?? 'Resident',
      amountPaid:         Number(collection.amount_paid),
      paymentMode:        collection.payment_mode,
      utrReference:       null,
      monthsPeriod:       labelDisplay(collection.levy_label),
      monthsCovered:      1,
      chargeDescription:  labelDisplay(collection.levy_label),
      periodLabel:         'AMC',
    };

    const buffer = await renderToBuffer(React.createElement(ReceiptPDF, { data: receiptData }) as never);

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${receiptData.receiptNumber}.pdf"`,
      },
    });
  } catch (err) {
    console.error('[pdf/levy GET]', err);
    return NextResponse.json({ error: 'Failed to generate AMC receipt' }, { status: 500 });
  }
}
