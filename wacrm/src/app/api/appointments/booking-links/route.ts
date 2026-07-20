// ============================================================
// GET/POST /api/appointments/booking-links
// Manage the account's public scheduling pages. Each link has a
// unique `token` used in /book/<token>. Dashboard-internal.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

function shortToken(): string {
  // 16-char URL-safe token. crypto is available in the route runtime.
  return (
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 18)
  );
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await ctx.supabase
      .from('booking_links')
      .select('*, contact:contacts (id, name, phone)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[GET /api/appointments/booking-links]', error);
      return NextResponse.json({ error: 'Failed to load booking links' }, { status: 500 });
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
      `bookingLink:create:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body?.title || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('booking_links')
      .insert({
        account_id: ctx.accountId,
        token: shortToken(),
        title: body.title,
        description: typeof body.description === 'string' ? body.description : null,
        contact_id:
          typeof body.contact_id === 'string' ? body.contact_id : null,
        active: body.active !== false,
      })
      .select()
      .single();
    if (error) {
      console.error('[POST /api/appointments/booking-links]', error);
      return NextResponse.json({ error: 'Failed to create booking link' }, { status: 500 });
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
      .from('booking_links')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[DELETE /api/appointments/booking-links]', error);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
