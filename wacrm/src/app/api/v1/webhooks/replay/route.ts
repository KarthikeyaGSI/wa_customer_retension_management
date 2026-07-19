import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import type { WebhookEvent } from '@/lib/webhooks/events';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const body = await request.json().catch(() => null) as {
      delivery_id?: string;
      event?: WebhookEvent;
      payload?: unknown;
    } | null;

    if (!body) {
      return fail('bad_request', 'Request body required', 400);
    }

    const db = supabaseAdmin();

    // Replay a specific delivery
    if (body.delivery_id) {
      const { data: log, error } = await db
        .from('webhook_delivery_logs')
        .select('*, webhook_endpoints (id, url, secret, is_active)')
        .eq('id', body.delivery_id)
        .eq('account_id', ctx.accountId)
        .single();

      if (error || !log) {
        return fail('not_found', 'Delivery log not found', 404);
      }

      if (!log.webhook_endpoints?.is_active) {
        return fail('bad_request', 'Endpoint is inactive', 400);
      }

      // Re-dispatch using the original payload
      const endpoint = log.webhook_endpoints[0] as any;
      await dispatchWebhookEvent(supabaseAdmin(), ctx.accountId, log.event, log.payload);

      return ok({ replayed: true, delivery_id: body.delivery_id });
    }

    // Re-send a specific event with custom payload
    if (body.event && body.payload) {
      await dispatchWebhookEvent(supabaseAdmin(), ctx.accountId, body.event, body.payload);
      return ok({ resent: true });
    }

    return fail('bad_request', 'Provide delivery_id or (event + payload)', 400);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}