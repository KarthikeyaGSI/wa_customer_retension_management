// ============================================================
// GET/POST/PATCH/DELETE /api/appointments/availability
// Weekly open-window configuration for the account. One row per
// weekday (0=Sun..6=Sat). Dashboard-internal (cookie + RLS).
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await ctx.supabase
      .from('appointment_availability')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('day_of_week', { ascending: true });
    if (error) {
      console.error('[GET /api/appointments/availability]', error);
      return NextResponse.json({ error: 'Failed to load availability' }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const day = Number(body.day_of_week);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return NextResponse.json({ error: 'day_of_week must be 0–6' }, { status: 400 });
    }

    const insert = {
      account_id: ctx.accountId,
      day_of_week: day,
      start_minutes: Number(body.start_minutes ?? 540),
      end_minutes: Number(body.end_minutes ?? 1020),
      slot_minutes: Number(body.slot_minutes ?? 30),
      timezone: typeof body.timezone === 'string' ? body.timezone : 'UTC',
    };

    const { data, error } = await ctx.supabase
      .from('appointment_availability')
      .upsert(insert, { onConflict: 'account_id,day_of_week' })
      .select()
      .single();
    if (error) {
      console.error('[POST /api/appointments/availability]', error);
      return NextResponse.json({ error: 'Failed to save availability' }, { status: 500 });
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { error } = await ctx.supabase
      .from('appointment_availability')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[DELETE /api/appointments/availability]', error);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
