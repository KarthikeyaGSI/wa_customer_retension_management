// ============================================================
// GET/POST /api/forms  — manage intake forms (dashboard-internal)
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import type { FormField } from '@/types';

function shortToken(): string {
  return (
    globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16) ??
    Math.random().toString(36).slice(2, 18)
  );
}

function coerceFields(input: unknown): FormField[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      name: String(f.name ?? ''),
      label: String(f.label ?? f.name ?? ''),
      type: (['text', 'email', 'tel', 'textarea', 'select', 'number'].includes(
        f.type as string,
      )
        ? (f.type as FormField['type'])
        : 'text'),
      required: Boolean(f.required),
      options: Array.isArray(f.options)
        ? (f.options as unknown[]).map(String)
        : undefined,
    }))
    .filter((f) => f.name.length > 0);
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const { data, error } = await ctx.supabase
      .from('forms')
      .select('*, pipeline:pipelines (id, name), stage:pipeline_stages (id, name)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[GET /api/forms]', error);
      return NextResponse.json({ error: 'Failed to load forms' }, { status: 500 });
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
      `form:create:${ctx.userId}`,
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
      .from('forms')
      .insert({
        account_id: ctx.accountId,
        token: shortToken(),
        title: body.title,
        description: typeof body.description === 'string' ? body.description : null,
        fields: coerceFields(body.fields),
        pipeline_id:
          typeof body.pipeline_id === 'string' ? body.pipeline_id : null,
        stage_id: typeof body.stage_id === 'string' ? body.stage_id : null,
        trigger_automations: body.trigger_automations !== false,
        active: body.active !== false,
      })
      .select()
      .single();
    if (error) {
      console.error('[POST /api/forms]', error);
      return NextResponse.json({ error: 'Failed to create form' }, { status: 500 });
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
