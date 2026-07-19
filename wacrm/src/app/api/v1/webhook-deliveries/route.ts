import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const { searchParams } = new URL(request.url);
    const endpointId = searchParams.get('endpoint_id');
    const status = searchParams.get('status'); // 'delivered' | 'failed' | 'pending'
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    let query = supabaseAdmin()
      .from('webhook_delivery_logs')
      .select(`
        id,
        delivery_id,
        endpoint_id,
        event,
        attempt,
        status_code,
        response_body,
        error_message,
        duration_ms,
        created_at,
        webhook_endpoints (url, events)
      `)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (endpointId) {
      query = query.eq('endpoint_id', endpointId);
    }

    if (status === 'delivered') {
      query = query.not('status_code', 'is', null).gte('status_code', 200).lte('status_code', 299);
    } else if (status === 'failed') {
      query = query.or('status_code.is.null,status_code.gte.400,error_message.not.is.null');
    }

    const { data, error } = await query;

    if (error) {
      console.error('[api/v1/webhook-deliveries] list error:', error);
      return fail('internal', 'Failed to fetch delivery logs', 500);
    }

    return okList(
      (data ?? []).map((row) => {
        const ep = Array.isArray(row.webhook_endpoints) ? row.webhook_endpoints[0] : row.webhook_endpoints;
        return {
          id: row.id,
          delivery_id: row.delivery_id,
          endpoint_id: row.endpoint_id,
          endpoint_url: ep?.url ?? null,
          endpoint_events: ep?.events ?? null,
          event: row.event,
          attempt: row.attempt,
          status_code: row.status_code,
          response_body: row.response_body,
          error_message: row.error_message,
          duration_ms: row.duration_ms,
          created_at: row.created_at,
        };
      }),
      offset + limit < (data?.length ?? 0) ? String(offset + limit) : null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}