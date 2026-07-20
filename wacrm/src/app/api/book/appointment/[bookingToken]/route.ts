// ============================================================
// Public appointment manage — /api/book/appointment/[bookingToken]
//
// Lets a contact reschedule (PATCH) or cancel (DELETE) their own
// booking using the unguessable per-appointment token. No auth.
// Uses the service-role client, scoped by the resolved account.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingToken: string }> },
) {
  try {
    const { bookingToken } = await params;
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('appointments')
      .select('id, scheduled_at, duration_minutes, status, customer_name, notes')
      .eq('booking_token', bookingToken)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[GET /api/book/appointment/[t]]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookingToken: string }> },
) {
  try {
    const { bookingToken } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body?.scheduled_at || typeof body.scheduled_at !== 'string') {
      return NextResponse.json({ error: 'scheduled_at required' }, { status: 400 });
    }
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('appointments')
      .update({
        scheduled_at: body.scheduled_at,
        duration_minutes: Number(body.duration_minutes ?? 30),
        status: 'confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('booking_token', bookingToken)
      .neq('status', 'cancelled')
      .select()
      .single();
    if (error || !data) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[PATCH /api/book/appointment/[t]]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ bookingToken: string }> },
) {
  try {
    const { bookingToken } = await params;
    const db = supabaseAdmin();
    const { error } = await db
      .from('appointments')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('booking_token', bookingToken);
    if (error) {
      console.error('[DELETE /api/book/appointment/[t]]', error);
      return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/book/appointment/[t]]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
