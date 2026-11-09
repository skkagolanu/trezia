import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { ReceiptPDF } from '@/lib/pdf/receipt';
import { uploadPdf, levyReceiptKey } from '@/lib/storage/r2';
import { formatDate } from '@/lib/utils/date';
import { labelDisplay } from '@/lib/utils/levy-label';
import React from 'react';

export async function generateAndStoreLevyReceipt(collectionId: string, societyId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: collection } = await supabase
    .from('amc_collections')
    .select('id, society_id, levy_label, amount_paid, payment_date, payment_mode, units!amc_unit_same_society(flat_number, residents!residents_unit_same_society(full_name, is_primary, is_active))')
    .eq('id', collectionId)
    .eq('society_id', societyId)
    .single();

  if (!collection) return null;

  const { data: config } = await supabase
    .from('society_config')
    .select('name, registration_number, address, mobile')
    .eq('society_id', collection.society_id)
    .single();

  const unit = collection.units as unknown as {
    flat_number: string;
    residents: Array<{ full_name: string; is_primary: boolean; is_active: boolean }>;
  } | null;

  const residents = unit?.residents ?? [];
  const primary = residents.find(r => r.is_primary && r.is_active) ?? residents[0];

  const receiptData = {
    societyName:        config?.name ?? 'Society',
    registrationNumber: config?.registration_number ?? null,
    address:            config?.address ?? null,
    mobile:             config?.mobile ?? null,
    receiptNumber:      `LEV-${collectionId.slice(0, 8).toUpperCase()}`,
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

  if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID) return null;

  const key = levyReceiptKey(collection.society_id, collectionId);
  const pdfUrl = await uploadPdf(key, Buffer.from(buffer));

  await supabase
    .from('amc_collections')
    .update({ pdf_url: pdfUrl })
    .eq('id', collectionId);

  return pdfUrl;
}
