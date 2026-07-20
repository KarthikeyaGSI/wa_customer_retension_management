// ============================================================
// DELETE /api/forms/[id]  — remove an intake form (dashboard-internal)
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = await checkRateLimit(
      `form:delete:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const { error } = await ctx.supabase
      .from('forms')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) {
      console.error('[DELETE /api/forms/[id]]', error);
      return NextResponse.json({ error: 'Failed to delete form' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
