// ============================================================
// PATCH/DELETE /api/appointments/[id]
// Update or cancel an appointment. Dashboard-internal.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const EDITABLE = [
  'scheduled_at',
  'duration_minutes',
  'status',
  'notes',
  'customer_name',
  'customer_phone',
  'contact_id',
  'deal_id',
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const limit = await checkRateLimit(
      `appointment:update:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const key of EDITABLE) {
      if (key in body) {
        const v = body[key];
        updates[key] = typeof v === 'string' || typeof v === 'number' || v === null ? v : null;
      }
    }

    const { data, error } = await ctx.supabase
      .from('appointments')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select()
      .single();
    if (error) {
      console.error('[PATCH /api/appointments/[id]]', error);
      return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const { error } = await ctx.supabase
      .from('appointments')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[DELETE /api/appointments/[id]]', error);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
