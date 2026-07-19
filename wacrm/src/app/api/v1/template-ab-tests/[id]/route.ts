import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;

    const db = supabaseAdmin();

    const { data, error } = await db
      .from('template_ab_tests')
      .select(`
        *,
        template_a:message_templates!template_a_id (id, name, language, status, body_text),
        template_b:message_templates!template_b_id (id, name, language, status, body_text),
        results:template_ab_test_results (*)
      `)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .single();

    if (error || !data) return fail('not_found', 'A/B test not found', 404);

    return ok({
      id: data.id,
      name: data.name,
      status: data.status,
      split_percentage: data.split_percentage,
      winner: data.winner,
      started_at: data.started_at,
      ended_at: data.ended_at,
      template_a: data.template_a,
      template_b: data.template_b,
      results: data.results,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;

    const body = await request.json().catch(() => null) as {
      status?: 'draft' | 'running' | 'paused' | 'completed';
      winner?: 'A' | 'B' | 'inconclusive';
    } | null;

    if (!body || (!body.status && !body.winner)) {
      return fail('bad_request', 'status or winner required', 400);
    }

    const db = supabaseAdmin();

    const { data: existing } = await db
      .from('template_ab_tests')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .single();

    if (!existing) return fail('not_found', 'A/B test not found', 404);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.status) {
      updates.status = body.status;
      if (body.status === 'running' && !updates.started_at) {
        updates.started_at = new Date().toISOString();
      }
      if (['paused', 'completed'].includes(body.status) && !updates.ended_at) {
        updates.ended_at = new Date().toISOString();
      }
    }
    if (body.winner) updates.winner = body.winner;

    const { error } = await db
      .from('template_ab_tests')
      .update(updates)
      .eq('id', id);

    if (error) return fail('internal', 'Failed to update A/B test', 500);

    return ok({ updated: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;

    const db = supabaseAdmin();

    const { error } = await db
      .from('template_ab_tests')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) return fail('internal', 'Failed to delete A/B test', 500);

    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}