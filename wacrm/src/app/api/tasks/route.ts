// ============================================================
// GET  /api/tasks  — list tasks for the current account
// POST /api/tasks  — create a task
//
// Dashboard-internal routes: auth via cookie session + RLS
// (requireRole). RLS scopes every row to the caller's account,
// but we still filter by account_id explicitly for precision.
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
    const assigneeId = searchParams.get('assignee_id');
    const limit = Math.min(
      parseInt(searchParams.get('limit') ?? '100', 10) || 100,
      200,
    );

    let query = ctx.supabase
      .from('tasks')
      .select(
        `*, assignee:profiles!tasks_assignee_id_fkey (id, full_name, avatar_url), contact:contacts (id, name, phone), deal:deals (id, title)`,
      )
      .eq('account_id', ctx.accountId)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) query = query.eq('status', status);
    if (assigneeId) query = query.eq('assignee_id', assigneeId);

    const { data, error } = await query;
    if (error) {
      console.error('[GET /api/tasks] error:', error);
      return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
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
      `task:create:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body?.title || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const insert: Record<string, unknown> = {
      account_id: ctx.accountId,
      title: body.title,
      description:
        typeof body.description === 'string' ? body.description : null,
      status: typeof body.status === 'string' ? body.status : 'todo',
      priority: typeof body.priority === 'string' ? body.priority : 'medium',
      assignee_id:
        typeof body.assignee_id === 'string' ? body.assignee_id : null,
      contact_id: typeof body.contact_id === 'string' ? body.contact_id : null,
      deal_id: typeof body.deal_id === 'string' ? body.deal_id : null,
      due_at: typeof body.due_at === 'string' ? body.due_at : null,
      remind_at: typeof body.remind_at === 'string' ? body.remind_at : null,
      created_by: ctx.userId,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await ctx.supabase
      .from('tasks')
      .insert(insert)
      .select()
      .single();

    if (error) {
      console.error('[POST /api/tasks] error:', error);
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
