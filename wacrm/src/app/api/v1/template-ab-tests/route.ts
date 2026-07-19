import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 'draft' | 'running' | 'paused' | 'completed'
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    let query = supabaseAdmin()
      .from('template_ab_tests')
      .select(`
        *,
        template_a:message_templates!template_a_id (id, name, language, status),
        template_b:message_templates!template_b_id (id, name, language, status),
        results:template_ab_test_results (*)
      `)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return fail('internal', 'Failed to fetch A/B tests', 500);

    return okList(
      (data ?? []).map(row => ({
        id: row.id,
        name: row.name,
        status: row.status,
        split_percentage: row.split_percentage,
        winner: row.winner,
        started_at: row.started_at,
        ended_at: row.ended_at,
        template_a: row.template_a,
        template_b: row.template_b,
        results: row.results,
      })),
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const body = await request.json().catch(() => null) as {
      name: string;
      template_a_id: string;
      template_b_id: string;
      split_percentage?: number;
    } | null;

    if (!body?.name || !body?.template_a_id || !body?.template_b_id) {
      return fail('bad_request', 'name, template_a_id, template_b_id required', 400);
    }

    const db = supabaseAdmin();

    // Verify both templates belong to account
    const { data: templates } = await db
      .from('message_templates')
      .select('id, name')
      .eq('account_id', ctx.accountId)
      .in('id', [body.template_a_id, body.template_b_id]);

    if (!templates || templates.length !== 2) {
      return fail('not_found', 'One or both templates not found in this account', 404);
    }

    if (body.template_a_id === body.template_b_id) {
      return fail('bad_request', 'Template A and B must be different', 400);
    }

    const { data, error } = await db.from('template_ab_tests').insert({
      account_id: ctx.accountId,
      name: body.name,
      template_a_id: body.template_a_id,
      template_b_id: body.template_b_id,
      split_percentage: body.split_percentage ?? 50,
      status: 'draft',
    }).select().single();

    if (error) return fail('internal', 'Failed to create A/B test', 500);

    return ok(data, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}