// ============================================================
// GET /api/tasks/reminders/cron
//
// Sends an in-app notification to each task's assignee whose
// `remind_at` has passed and which is not yet done. Clears
// `remind_at` so each task fires once. Protected by the shared
// cron secret (x-cron-secret header) — not a cookie session, so
// it can be called by an external scheduler (Vercel Cron, GitHub
// Action, etc.). Uses the service-role client and scopes writes
// by account_id explicitly.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';

export const dynamic = 'force-dynamic';

function unauthorized() {
  return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.TASK_CRON_SECRET ?? process.env.SLA_CRON_SECRET;
  if (!expected) {
    return new NextResponse(
      JSON.stringify({ error: 'not configured' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }
  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) return unauthorized();

  try {
    const nowIso = new Date().toISOString();

    // Pending reminders: remind_at in the past, not done.
    const { data: due, error } = await supabaseAdmin()
      .from('tasks')
      .select('id, account_id, title, assignee_id, due_at')
      .not('remind_at', 'is', null)
      .lte('remind_at', nowIso)
      .neq('status', 'done');

    if (error) {
      console.error('[tasks-reminders-cron] query error:', error);
      return new NextResponse(
        JSON.stringify({ error: String(error.message) }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }

    let sent = 0;
    for (const task of due ?? []) {
      if (!task.assignee_id) continue;

      // The assignee_id is a profile.id; notifications.user_id is
      // auth.users.id. Resolve via profiles.
      const { data: profile } = await supabaseAdmin()
        .from('profiles')
        .select('user_id')
        .eq('id', task.assignee_id)
        .maybeSingle();
      if (!profile?.user_id) continue;

      const dueText = task.due_at
        ? new Date(task.due_at).toLocaleString()
        : 'no due date';

      await supabaseAdmin().from('notifications').insert({
        account_id: task.account_id,
        user_id: profile.user_id,
        type: 'task_reminder',
        title: 'Task reminder',
        body: `"${task.title}" is due ${dueText}.`,
      });

      // Clear remind_at so we don't re-notify every run.
      await supabaseAdmin()
        .from('tasks')
        .update({ remind_at: null })
        .eq('id', task.id);

      sent += 1;
    }

    return new NextResponse(
      JSON.stringify({ ok: true, sent, checked: (due ?? []).length }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch (err) {
    console.error('[tasks-reminders-cron] error:', err);
    return new NextResponse(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}
