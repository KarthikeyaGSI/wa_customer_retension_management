// ============================================================
// PATCH /api/tasks/[id] — update a task
// DELETE /api/tasks/[id] — delete a task
//
// Dashboard-internal routes (cookie session + RLS). On completion
// (status → done) we stamp completed_at so downstream queries and
// the reminder cron can skip finished work.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const EDITABLE = [
  'title',
  'description',
  'status',
  'priority',
  'assignee_id',
  'contact_id',
  'deal_id',
  'due_at',
  'remind_at',
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');

    const limit = await checkRateLimit(
      `task:update:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const key of EDITABLE) {
      if (key in body) {
        const value = body[key];
        updates[key] = typeof value === 'string' || value === null ? value : null;
      }
    }

    // Stamp completion timestamp when moving to / from done.
    if (body.status === 'done') {
      updates.completed_at = new Date().toISOString();
    } else if (typeof body.status === 'string' && body.status !== 'done') {
      updates.completed_at = null;
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select()
      .single();

    if (error) {
      console.error('[PATCH /api/tasks/[id]] error:', error);
      return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

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

    const limit = await checkRateLimit(
      `task:delete:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { error } = await ctx.supabase
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[DELETE /api/tasks/[id]] error:', error);
      return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
