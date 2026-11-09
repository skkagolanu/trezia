import { NextRequest, NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialReader } from '@/lib/supabase/require-auth';
import { DuesNoticePDF, type DuesNoticeData } from '@/lib/pdf/dues-notice';
import { formatDate, formatMonthYear } from '@/lib/utils/date';
import { addDays, selectUnpaidBills } from '@/lib/utils/dues-notice';
import { outstandingAmount } from '@/lib/utils/billing';
import { fetchAll } from '@/lib/supabase/fetch-all';
import React from 'react';
import { labelDisplay } from '@/lib/utils/levy-label';

export const runtime = 'nodejs';

type Paged<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

interface BillRow {
  unit_id: string;
  bill_period_year: number;
  bill_period_month: number;
  status: string;
  due_date: string;
  payable_amount: number | string;
  amount_settled: number | string;
}
interface ResidentRow { full_name: string; is_primary: boolean }
interface LevyRow {
  unit_id: string;
  levy_label: string;
  amount: number | string;
  amount_settled: number | string;
  status: string;
  created_at: string;
}
interface UnitRow {
  id: string;
  flat_number: string;
  residents: ResidentRow[] | null;
}

function primaryName(residents: ResidentRow[] | null): string {
  if (!Array.isArray(residents) || residents.length === 0) return 'Resident';
  return (residents.find(r => r.is_primary) ?? residents[0]).full_name ?? 'Resident';
}

export async function GET(request: NextRequest) {
  const auth = await requireFinancialReader();
  if (auth.unauthorized) return auth.unauthorized;

  const { searchParams } = new URL(request.url);
  const flat = searchParams.get('flat');
  const all = searchParams.get('all') === '1';
  if (!flat && !all) {
    return NextResponse.json({ error: 'flat or all=1 required' }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    const { data: config, error: configError } = await supabase
      .from('society_config')
      .select('name, registration_number, address, mobile, upi_id, dues_notice_title, dues_notice_payby_days, dues_notice_footer')
      .eq('society_id', auth.societyId)
      .single();

    if (configError) {
      return NextResponse.json({ error: 'Financial settings could not be loaded. Retry before generating a notice.' }, { status: 503 });
    }

    if (config?.dues_notice_payby_days == null) {
      return NextResponse.json(
        { error: 'Society dues notice pay-by window is not configured — set it in Settings.' },
        { status: 422 },
      );
    }

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const payByDays = config.dues_notice_payby_days;
    const noticeDate = formatDate(todayIso);
    const payByDate = formatDate(addDays(todayIso, payByDays));

    const baseData = {
      societyName:        config?.name ?? 'Society',
      registrationNumber: config?.registration_number ?? null,
      address:            config?.address ?? null,
      mobile:             config?.mobile ?? null,
      upiId:              config?.upi_id ?? null,
      noticeTitle:        config?.dues_notice_title ?? 'Maintenance Dues Reminder',
      footer:             config?.dues_notice_footer ?? '',
      noticeDate,
      payByDate,
    };

    function buildNotice(unit: UnitRow, bills: BillRow[], levies: LevyRow[]): DuesNoticeData | null {
      const unpaid = selectUnpaidBills(bills);

      const maintenanceItems = unpaid
        .map(b => ({
          period: formatMonthYear(b.bill_period_year, b.bill_period_month),
          amount: outstandingAmount(b),
        }))
        .filter(item => item.amount > 0);
      const levyItems = levies
        .filter(levy => levy.status === 'PENDING')
        .map(levy => ({
          period: labelDisplay(levy.levy_label),
          amount: Math.max(0, Number(levy.amount) - Number(levy.amount_settled)),
        }))
        .filter(item => item.amount > 0.005);
      const items = [...maintenanceItems, ...levyItems];
      if (items.length === 0) return null;
      return {
        ...baseData,
        flatNumber:  unit.flat_number,
        residentName: primaryName(unit.residents),
        items,
        chargesCount: items.length,
        totalDue:    items.reduce((s, i) => s + i.amount, 0),
      };
    }

    let notices: DuesNoticeData[] = [];

    if (flat) {
      const { data: unit, error: unitError } = await supabase
        .from('units')
        .select('id, flat_number, residents!residents_unit_same_society(full_name, is_primary)')
        .eq('society_id', auth.societyId)
        .eq('flat_number', flat)
        .single();
      if (unitError) {
        const status = unitError.code === 'PGRST116' ? 404 : 503;
        return NextResponse.json({ error: status === 404 ? 'Flat not found' : 'Flat data could not be loaded. Retry before generating a notice.' }, { status });
      }
      if (!unit) return NextResponse.json({ error: 'Flat not found' }, { status: 404 });

      const [billsResult, leviesResult] = await Promise.all([
        supabase
          .from('bills')
          .select('unit_id, bill_period_year, bill_period_month, status, due_date, payable_amount, amount_settled')
          .eq('society_id', auth.societyId)
          .eq('unit_id', (unit as unknown as UnitRow).id)
          .eq('is_voided', false)
          .in('status', ['OVERDUE', 'ISSUED']),
        supabase
          .from('levy_assessments')
          .select('unit_id, levy_label, amount, amount_settled, status, created_at')
          .eq('society_id', auth.societyId)
          .eq('unit_id', (unit as unknown as UnitRow).id)
          .eq('is_voided', false)
          .eq('status', 'PENDING')
          .order('created_at'),
      ]);
      if (billsResult.error || leviesResult.error) {
        return NextResponse.json({ error: 'Complete dues could not be loaded. No notice was generated.' }, { status: 503 });
      }
      const bills = billsResult.data;
      const levies = leviesResult.data;

      const notice = buildNotice(
        unit as unknown as UnitRow,
        (bills ?? []) as BillRow[],
        (levies ?? []) as LevyRow[],
      );
      if (!notice) return NextResponse.json({ error: 'Flat has no outstanding dues' }, { status: 400 });
      notices = [notice];
    } else {
      const { data: units, error: unitsError } = await supabase
        .from('units')
        .select('id, flat_number, residents!residents_unit_same_society(full_name, is_primary)')
        .eq('society_id', auth.societyId)
        .eq('is_active', true)
        .eq('is_test_unit', false)
        .order('flat_number');
      if (unitsError) {
        return NextResponse.json({ error: 'Resident units could not be loaded. No notices were generated.' }, { status: 503 });
      }

      const bills = await fetchAll<BillRow & { id: string }>((f, t) => supabase
        .from('bills')
        .select('id, unit_id, bill_period_year, bill_period_month, status, due_date, payable_amount, amount_settled')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .in('status', ['OVERDUE', 'ISSUED'])
        .order('unit_id')
        .order('id')
        .range(f, t) as unknown as Paged<BillRow & { id: string }>);
      const levies = await fetchAll<LevyRow & { id: string }>((f, t) => supabase
        .from('levy_assessments')
        .select('id, unit_id, levy_label, amount, amount_settled, status, created_at')
        .eq('society_id', auth.societyId)
        .eq('is_voided', false)
        .eq('status', 'PENDING')
        .order('unit_id')
        .order('created_at')
        .order('id')
        .range(f, t) as unknown as Paged<LevyRow & { id: string }>);

      const byUnit = new Map<string, BillRow[]>();
      for (const b of bills) {
        if (!byUnit.has(b.unit_id)) byUnit.set(b.unit_id, []);
        byUnit.get(b.unit_id)!.push(b);
      }
      const leviesByUnit = new Map<string, LevyRow[]>();
      for (const levy of levies) {
        if (!leviesByUnit.has(levy.unit_id)) leviesByUnit.set(levy.unit_id, []);
        leviesByUnit.get(levy.unit_id)!.push(levy);
      }
      for (const u of (units ?? []) as unknown as UnitRow[]) {
        const notice = buildNotice(u, byUnit.get(u.id) ?? [], leviesByUnit.get(u.id) ?? []);
        if (notice) notices.push(notice);
      }
      if (notices.length === 0) {
        return NextResponse.json({ error: 'No flats have outstanding dues' }, { status: 400 });
      }
    }

    const buffer = await renderToBuffer(React.createElement(DuesNoticePDF, { notices }) as never);
    const filename = flat ? `dues-notice-${flat}.pdf` : 'dues-notices-all.pdf';
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[pdf/dues-notice GET]', err);
    return NextResponse.json({ error: 'Failed to generate dues notice' }, { status: 500 });
  }
}
