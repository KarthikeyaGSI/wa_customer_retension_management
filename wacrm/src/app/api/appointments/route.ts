// ============================================================
// GET/POST /api/appointments
// List + create appointments for the account. Dashboard-internal.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const contactId = searchParams.get('contact_id');

    let query = ctx.supabase
      .from('appointments')
      .select(
        `*, contact:contacts (id, name, phone), booking_link:booking_links (id, title)`,
      )
      .eq('account_id', ctx.accountId)
      .order('scheduled_at', { ascending: true })
      .limit(200);

    if (status) query = query.eq('status', status);
    if (contactId) query = query.eq('contact_id', contactId);

    const { data, error } = await query;
    if (error) {
      console.error('[GET /api/appointments]', error);
      return NextResponse.json({ error: 'Failed to load appointments' }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `appointment:create:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body?.scheduled_at || typeof body.scheduled_at !== 'string') {
      return NextResponse.json({ error: 'scheduled_at required' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('appointments')
      .insert({
        account_id: ctx.accountId,
        booking_link_id:
          typeof body.booking_link_id === 'string' ? body.booking_link_id : null,
        booking_token:
          globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
        contact_id: typeof body.contact_id === 'string' ? body.contact_id : null,
        deal_id: typeof body.deal_id === 'string' ? body.deal_id : null,
        customer_name:
          typeof body.customer_name === 'string' ? body.customer_name : null,
        customer_phone:
          typeof body.customer_phone === 'string' ? body.customer_phone : null,
        scheduled_at: body.scheduled_at,
        duration_minutes: Number(body.duration_minutes ?? 30),
        status: typeof body.status === 'string' ? body.status : 'confirmed',
        notes: typeof body.notes === 'string' ? body.notes : null,
      })
      .select()
      .single();
    if (error) {
      console.error('[POST /api/appointments]', error);
      return NextResponse.json({ error: 'Failed to create appointment' }, { status: 500 });
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
