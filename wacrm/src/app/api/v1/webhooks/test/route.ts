import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import type { WebhookEvent } from '@/lib/webhooks/events';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const body = await request.json().catch(() => null) as {
      event: WebhookEvent;
      test_payload?: unknown;
    } | null;

    if (!body?.event) {
      return fail('bad_request', 'event required', 400);
    }

    const db = supabaseAdmin();

    // Get active endpoints for this event
    const { data: endpoints } = await db
      .from('webhook_endpoints')
      .select('id, url, secret')
      .eq('account_id', ctx.accountId)
      .eq('is_active', true)
      .contains('events', [body.event]);

    if (!endpoints?.length) {
      return fail('not_found', 'No active endpoints for this event', 404);
    }

    const testPayload = body.test_payload ?? {
      test: true,
      timestamp: new Date().toISOString(),
      message: 'This is a test webhook from wacrm',
    };

    let sent = 0;
    let failed = 0;

    for (const endpoint of endpoints) {
      try {
        await dispatchWebhookEvent(supabaseAdmin(), ctx.accountId, body.event, testPayload);
        sent++;
      } catch (err) {
        failed++;
        console.error('[webhook-test] Failed to send to', endpoint.url, err);
      }
    }

    return ok({ sent, failed, total: endpoints.length });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}