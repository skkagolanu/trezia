import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { firstRelation } from '@/lib/supabase/first-relation';
import { ReceiptPDF } from '@/lib/pdf/receipt';
import { legacyReceiptKey, receiptKey, resolveCompatibleObjectUrl, uploadPdf } from '@/lib/storage/r2';
import { sendReceiptEmail } from '@/lib/email/resend';
import { formatDate } from '@/lib/utils/date';
import { buildWhatsAppLink } from '@/lib/utils/collect-request';
import React from 'react';

export interface GenerateReceiptResult {
  pdfUrl: string | null;
  whatsappUrl: string | null;
  receiptNumber: string | null;
}

export async function generateAndStoreReceipt(payment_id: string, societyId: string): Promise<GenerateReceiptResult> {
  const supabase = await createClient();

  const { data: payment, error: payErr } = await supabase
    .from('payments')
    .select(`
      id, society_id, receipt_number, amount_paid, payment_mode, payment_date,
      utr_reference, months_covered, months_detail,
      units!payments_unit_same_society(flat_number),
      residents!payments_resident_same_society(full_name, phone, email, notification_channel, consent_given)
    `)
    .eq('id', payment_id)
    .eq('society_id', societyId)
    .single();

  if (payErr || !payment) throw new Error('Payment not found');

  const { data: config } = await supabase
    .from('society_config')
    .select('name, registration_number, address, mobile')
    .eq('society_id', payment.society_id)
    .single();
  const { data: society } = await supabase
    .from('societies')
    .select('legacy_storage_layout')
    .eq('id', payment.society_id)
    .single();

  const unit = firstRelation<{ flat_number: string }>(payment.units);
  const resident = firstRelation<{
    full_name: string;
    phone: string | null;
    email: string | null;
    notification_channel: string;
    consent_given: boolean;
  }>(payment.residents);

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

  let pdfUrl: string | null = null;
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
    const key = receiptKey(payment.society_id, payment.receipt_number ?? payment_id);
    pdfUrl = await resolveCompatibleObjectUrl({
      societyId: payment.society_id,
      legacyStorageLayout: society?.legacy_storage_layout ?? null,
      scopedKey: key,
      legacyKey: legacyReceiptKey(payment.receipt_number ?? payment_id),
    }) ?? await uploadPdf(key, Buffer.from(buffer));

    await supabase
      .from('payments')
      .update({ receipt_pdf_url: pdfUrl })
      .eq('id', payment_id);
  }

  if (resident?.email && resident.consent_given && resident.notification_channel === 'EMAIL') {
    try {
      await sendReceiptEmail({
        to:              resident.email,
        residentName:    resident.full_name ?? 'Resident',
        flatNumber:      unit?.flat_number ?? '',
        monthsPeriod:    receiptData.monthsPeriod,
        amountPaid:      receiptData.amountPaid,
        receiptNumber:   receiptData.receiptNumber,
        paymentDate:     receiptData.receiptDate,
        paymentMode:     receiptData.paymentMode,
        // Private objects are available only through an authenticated PDF route.
        pdfUrl: null,
        societyName:     receiptData.societyName,
        treasurerMobile: config?.mobile ?? null,
      });
    } catch {
      // Email failure is non-fatal
    }
  }

  let whatsappUrl: string | null = null;
  if (resident?.phone && resident.consent_given) {
    const msg =
      `Dear ${resident.full_name ?? 'Resident'}, receipt for ${receiptData.monthsPeriod} ` +
      `₹${receiptData.amountPaid.toLocaleString('en-IN')} is ready. ` +
      `Receipt No: ${receiptData.receiptNumber}.` +
      '';
    whatsappUrl = buildWhatsAppLink(resident.phone, msg);
  }

  return { pdfUrl, whatsappUrl, receiptNumber: payment.receipt_number };
}
