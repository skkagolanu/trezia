import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireFinancialOperator } from '@/lib/supabase/require-auth';
import { ResidentSchema } from '@/lib/validation/schemas';

export async function GET(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  const unitId = request.nextUrl.searchParams.get('unit_id');

  if (!unitId) {
    return Response.json({ error: 'unit_id query param is required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('residents')
    .select('*')
    .eq('unit_id', unitId)
    .eq('society_id', auth.societyId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to load residents' }, { status: 500 });
  }

  return Response.json(data);
}

export async function POST(request: NextRequest) {
  const auth = await requireFinancialOperator();
  if (auth.unauthorized) return auth.unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ResidentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const data = parsed.data;
  const supabase = await createClient();

  const existingId = (body as Record<string, unknown>).id;
  const isUpdate = typeof existingId === 'string' && existingId.length > 0;

  if (isUpdate) {
    if (data.is_primary) {
      const { error: primaryError } = await supabase
        .from('residents')
        .update({ is_primary: false })
        .eq('unit_id', data.unit_id)
        .eq('is_primary', true)
        .neq('id', existingId);
      if (primaryError) {
        console.error(primaryError);
        return Response.json({ error: 'Failed to update resident' }, { status: 500 });
      }
    }

    const { data: updated, error } = await supabase
      .from('residents')
      .update({
        full_name: data.full_name,
        occupancy_type: data.occupancy_type,
        phone: data.phone ?? null,
        email: data.email ?? null,
        notification_channel: data.notification_channel,
        is_primary: data.is_primary,
        move_in_date: data.move_in_date ?? null,
        ...(data.move_out_date !== undefined ? { move_out_date: data.move_out_date } : {}),
        ...(data.is_active !== undefined ? { is_active: data.is_active } : {}),
        notes: data.notes ?? null,
        consent_given: data.consent_given,
        ...(data.consent_given ? { consent_date: new Date().toISOString().split('T')[0] } : {}),
      })
      .eq('id', existingId)
      .eq('unit_id', data.unit_id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(error);
      return Response.json({ error: 'Failed to update resident' }, { status: 500 });
    }
    if (!updated) {
      return Response.json({ error: 'Resident not found for this flat' }, { status: 404 });
    }

    return Response.json({ success: true, id: existingId });
  }

  if (data.is_primary) {
    await supabase
      .from('residents')
      .update({ is_primary: false })
      .eq('unit_id', data.unit_id)
      .eq('is_primary', true);
  }

  const { data: inserted, error } = await supabase
    .from('residents')
    .insert({
      society_id: auth.societyId,
      unit_id: data.unit_id,
      full_name: data.full_name,
      occupancy_type: data.occupancy_type,
      phone: data.phone ?? null,
      email: data.email ?? null,
      notification_channel: data.notification_channel,
      is_primary: data.is_primary,
      move_in_date: data.move_in_date ?? null,
      notes: data.notes ?? null,
      consent_given: data.consent_given,
      consent_date: data.consent_given ? new Date().toISOString().split('T')[0] : null,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) {
    console.error(error);
    return Response.json({ error: 'Failed to add resident' }, { status: 500 });
  }

  return Response.json({ success: true, id: inserted.id }, { status: 201 });
}
