import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'incidents' | 'automations' | 'webhooks' | 'all'
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);
    const since = searchParams.get('since'); // ISO date

    if (type === 'incidents' || type === 'all') {
      let query = supabaseAdmin()
        .from('incident_logs')
        .select('*')
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (since) query = query.gte('created_at', since);

      const { data, error } = await query;
      if (error) return fail('internal', 'Failed to fetch incidents', 500);

      if (type === 'incidents') {
        return okList(
          (data ?? []).map(row => ({
            id: row.id,
            incident_type: row.incident_type,
            summary: row.summary,
            payload: row.payload,
            status: row.status,
            root_cause: row.root_cause,
            action_taken: row.action_taken,
            fix_action: row.fix_action,
            created_at: row.created_at,
            resolved_at: row.resolved_at,
          })),
          null
        );
      }
    }

    if (type === 'automations' || type === 'all') {
      let query = supabaseAdmin()
        .from('automation_logs')
        .select('*, automations(name, trigger_type)')
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (since) query = query.gte('created_at', since);

      const { data, error } = await query;
      if (error) return fail('internal', 'Failed to fetch automation logs', 500);

      if (type === 'automations') {
        return okList(
          (data ?? []).map(row => ({
            id: row.id,
            automation_id: row.automation_id,
            automation_name: row.automations?.name,
            trigger_type: row.automations?.trigger_type,
            trigger_event: row.trigger_event,
            contact_id: row.contact_id,
            steps_executed: row.steps_executed,
            status: row.status,
            error_message: row.error_message,
            created_at: row.created_at,
          })),
          null
        );
      }
    }

    if (type === 'webhooks' || type === 'all') {
      let query = supabaseAdmin()
        .from('webhook_delivery_logs')
        .select('*, webhook_endpoints (url, events)')
        .eq('account_id', ctx.accountId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status === 'delivered') query = query.gte('status_code', 200).lte('status_code', 299);
      if (status === 'failed') query = query.or('status_code.is.null,status_code.gte.400,error_message.not.is.null');
      if (since) query = query.gte('created_at', since);

      const { data, error } = await query;
      if (error) return fail('internal', 'Failed to fetch webhook logs', 500);

      if (type === 'webhooks') {
        return okList(
          (data ?? []).map(row => {
            const ep = Array.isArray(row.webhook_endpoints) ? row.webhook_endpoints[0] : row.webhook_endpoints;
            return {
              id: row.id,
              delivery_id: row.delivery_id,
              endpoint_id: row.endpoint_id,
              endpoint_url: ep?.url,
              endpoint_events: ep?.events,
              event: row.event,
              attempt: row.attempt,
              status_code: row.status_code,
              response_body: row.response_body,
              error_message: row.error_message,
              duration_ms: row.duration_ms,
              created_at: row.created_at,
            };
          }),
          null
        );
      }
    }

    // Combined 'all' type - return summary counts
    if (type === 'all') {
      const [incidents, automations, webhooks] = await Promise.all([
        supabaseAdmin()
          .from('incident_logs')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId),
        supabaseAdmin()
          .from('automation_logs')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId),
        supabaseAdmin()
          .from('webhook_delivery_logs')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId),
      ]);

      return ok({
        incidents: { count: incidents.count ?? 0 },
        automations: { count: automations.count ?? 0 },
        webhook_deliveries: { count: webhooks.count ?? 0 },
      });
    }

    return fail('bad_request', 'Invalid type. Use: incidents, automations, webhooks, or all', 400);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}