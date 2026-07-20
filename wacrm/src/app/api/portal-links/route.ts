// ============================================================
// GET/POST /api/portal-links  — shareable customer portals
// (dashboard-internal). Each link is tied to one contact and
// exposes a read-only /portal/<token> page.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

function shortToken(): string {
  return (
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 18)
  );
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await ctx.supabase
      .from('portal_links')
      .select('*, contact:contacts (id, name, phone)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[GET /api/portal-links]', error);
      return NextResponse.json({ error: 'Failed to load portals' }, { status: 500 });
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
      `portal:create:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body?.contact_id || typeof body.contact_id !== 'string') {
      return NextResponse.json({ error: 'contact_id required' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('portal_links')
      .insert({
        account_id: ctx.accountId,
        token: shortToken(),
        contact_id: body.contact_id,
        title: typeof body.title === 'string' ? body.title : 'My account',
        active: body.active !== false,
      })
      .select()
      .single();
    if (error) {
      console.error('[POST /api/portal-links]', error);
      return NextResponse.json({ error: 'Failed to create portal link' }, { status: 500 });
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
      .from('portal_links')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[DELETE /api/portal-links/[id]]', error);
      return NextResponse.json({ error: 'Failed to delete portal' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
