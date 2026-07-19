import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { processWebhookDeliveryQueue } from '@/lib/webhooks/retry-queue';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const body = await request.json().catch(() => null) as {
      delivery_id?: string;
      endpoint_id?: string;
      event?: string;
      all_failed?: boolean;
    } | null;

    if (!body) {
      return fail('bad_request', 'Request body required', 400);
    }

    const db = supabaseAdmin();

    // Manual retry of a specific delivery
    if (body.delivery_id) {
      const { data: delivery, error } = await db
        .from('webhook_deliveries')
        .select('*')
        .eq('id', body.delivery_id)
        .eq('account_id', ctx.accountId)
        .single();

      if (error || !delivery) {
        return fail('not_found', 'Delivery not found', 404);
      }

      // Reset for retry
      await db
        .from('webhook_deliveries')
        .update({ status: 'pending', attempt: 0, next_retry_at: new Date().toISOString() })
        .eq('id', body.delivery_id);

      return ok({ retried: true, delivery_id: body.delivery_id });
    }

    // Retry all failed for an endpoint
    if (body.endpoint_id) {
      const { data: endpoint, error: epError } = await db
        .from('webhook_endpoints')
        .select('id')
        .eq('id', body.endpoint_id)
        .eq('account_id', ctx.accountId)
        .single();

      if (epError || !endpoint) {
        return fail('not_found', 'Endpoint not found', 404);
      }

      const { data: deliveries } = await db
        .from('webhook_deliveries')
        .select('id')
        .eq('endpoint_id', body.endpoint_id)
        .eq('status', 'failed');

      if (deliveries && deliveries.length > 0) {
        await db
          .from('webhook_deliveries')
          .update({ status: 'pending', attempt: 0, next_retry_at: new Date().toISOString() })
          .in('id', deliveries.map(d => d.id));

        // Trigger queue processing
        await processWebhookDeliveryQueue(supabaseAdmin());
      }

      return ok({ retried: deliveries?.length ?? 0 });
    }

    // Retry all failed for account (optional filter by event)
    if (body.all_failed) {
      let query = db
        .from('webhook_deliveries')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('status', 'failed');

      if (body.event) {
        query = query.eq('event', body.event);
      }

      const { data: deliveries } = await query.limit(500);

      if (deliveries && deliveries.length > 0) {
        await db
          .from('webhook_deliveries')
          .update({ status: 'pending', attempt: 0, next_retry_at: new Date().toISOString() })
          .in('id', deliveries.map(d => d.id));

        await processWebhookDeliveryQueue(supabaseAdmin());
      }

      return ok({ retried: deliveries?.length ?? 0 });
    }

    return fail('bad_request', 'Provide delivery_id, endpoint_id, or all_failed: true', 400);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}