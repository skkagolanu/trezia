import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireBackupManager, requireFinancialReader } from '@/lib/supabase/require-auth';
import { paymentsToCSV, expensesToCSV, duesToCSV, downloadFilename } from '@/lib/export/csv';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { buildBackupSnapshot } from '@/lib/snapshots/create';
import { readSocietyArtifactObject } from '@/lib/storage/r2';
import { safeDownloadFilename } from '@/lib/operations/attachments';

// Result shape for paginated Supabase queries with embedded relations.
type Paged<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'payments';
  const auth = type === 'backup' || type === 'artifact'
    ? await requireBackupManager()
    : await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;
  const from = searchParams.get('from');
  const to   = searchParams.get('to');

  if (type === 'artifact') {
    const key = searchParams.get('key');
    const storage = searchParams.get('storage');
    if (!key || (storage !== 'PUBLIC_ARTIFACTS' && storage !== 'PRIVATE_ARTIFACTS' && storage !== 'PRIVATE_ATTACHMENTS')) {
      return NextResponse.json({ error: 'A valid artifact key and storage are required' }, { status: 422 });
    }
    try {
      const bytes = await readSocietyArtifactObject({ societyId: auth.societyId, key, storage });
      return new NextResponse(Buffer.from(bytes), { headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeDownloadFilename(key.split('/').at(-1) ?? 'artifact')}"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      } });
    } catch {
      return NextResponse.json({ error: 'Artifact not found in this society' }, { status: 404 });
    }
  }

  const supabase = await createClient();

  if (type === 'payments') {
    // Paginate all matching rows for complete exports.
    type ExportPaymentRow = {
      receipt_number: string | null;
      amount_paid: number;
      payment_mode: string;
      payment_date: string;
      payment_time: string | null;
      months_covered: number | null;
      months_detail: string | null;
      utr_reference: string | null;
      collector_name: string | null;
      notes: string | null;
      is_voided: boolean;
      void_reason: string | null;
      created_at: string;
      row_hash: string | null;
      units: { flat_number: string } | null;
      residents: { full_name: string } | null;
    };
    let data: ExportPaymentRow[];
    try {
      data = await fetchAll<ExportPaymentRow>((f, t) => {
        let q = supabase
          .from('payments')
          .select(`
            receipt_number, amount_paid, payment_mode, payment_date, payment_time,
            months_covered, months_detail, utr_reference, collector_name, notes,
            is_voided, void_reason, created_at, row_hash,
            units!payments_unit_same_society(flat_number),
            residents!payments_resident_same_society(full_name)
          `)
          .order('payment_date', { ascending: false })
          .order('id', { ascending: false })
          .range(f, t);
        if (from) q = q.gte('payment_date', from);
        if (to)   q = q.lte('payment_date', to);
        return q as unknown as Paged<ExportPaymentRow>;
      });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }

    const rows = data.map(p => ({
      receipt_number: p.receipt_number,
      flat_number:    p.units?.flat_number ?? '',
      resident_name:  p.residents?.full_name ?? '',
      payment_date:   p.payment_date,
      payment_time:   p.payment_time,
      amount_paid:    Number(p.amount_paid),
      payment_mode:   p.payment_mode,
      months_covered: p.months_covered ?? 1,
      months_detail:  p.months_detail,
      utr_reference:  p.utr_reference,
      collector_name: p.collector_name,
      notes:          p.notes,
      is_voided:      p.is_voided,
      void_reason:    p.void_reason,
      created_at:     p.created_at,
      row_hash:       p.row_hash,
    }));

    const csv = paymentsToCSV(rows);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${downloadFilename('payments')}"`,
      },
    });
  }

  if (type === 'expenses') {
    // Paginate expense exports.
    type ExportExpenseRow = {
      expense_date: string;
      category: string;
      description: string | null;
      amount: number;
      paid_via: string | null;
      payee_name: string | null;
      reference_number: string | null;
      notes: string | null;
      is_voided: boolean;
      void_reason: string | null;
      created_at: string;
    };
    let data: ExportExpenseRow[];
    try {
      data = await fetchAll<ExportExpenseRow>((f, t) => {
        let q = supabase
          .from('expenditures')
          .select('expense_date, category, description, amount, paid_via, payee_name, reference_number, notes, is_voided, void_reason, created_at')
          .order('expense_date', { ascending: false })
          .order('id', { ascending: false })
          .range(f, t);
        if (from) q = q.gte('expense_date', from);
        if (to)   q = q.lte('expense_date', to);
        return q as unknown as Paged<ExportExpenseRow>;
      });
    } catch (err) {
      console.error(err);
      return NextResponse.json({ error: 'Failed to export expenses' }, { status: 500 });
    }

    const rows = data.map(e => ({
      expense_date:     e.expense_date,
      category:         e.category,
      description:      e.description ?? '',
      amount:           Number(e.amount),
      paid_via:         e.paid_via,
      payee_name:       e.payee_name,
      reference_number: e.reference_number,
      notes:            e.notes,
      is_voided:        e.is_voided,
      void_reason:      e.void_reason,
      created_at:       e.created_at,
    }));

    const csv = expensesToCSV(rows);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${downloadFilename('expenses')}"`,
      },
    });
  }

  if (type === 'dues') {
    const { data, error } = await supabase
      .from('v_dues_summary')
      .select('*')
      .order('flat_number');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map(d => ({
      flat_number:    d.flat_number,
      resident_name:  d.primary_resident,
      phone:          d.phone,
      email:          d.email,
      unpaid_months:  Number(d.unpaid_months ?? 0),
      total_due:      Number(d.total_due ?? 0),
      last_paid_date: d.last_paid_date,
    }));

    const csv = duesToCSV(rows);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${downloadFilename('dues')}"`,
      },
    });
  }

  if (type === 'backup') {
    // Reuse the paginated snapshot builder.
    const backup = await buildBackupSnapshot(auth.societyId, { includeAttachmentInventory: true });

    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${downloadFilename('backup', 'json')}"`,
      },
    });
  }

  return NextResponse.json({ error: 'type must be payments, expenses, dues, backup, or artifact' }, { status: 400 });
}
