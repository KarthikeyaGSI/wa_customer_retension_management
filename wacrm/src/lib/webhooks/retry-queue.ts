import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import type { WebhookEvent } from '@/lib/webhooks/events';

const DELIVERY_TIMEOUT_MS = 5000;
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1000;

interface WebhookDelivery {
  id: string;
  endpoint_id: string;
  account_id: string;
  event: WebhookEvent;
  payload: unknown;
  attempt: number;
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function queueWebhookDelivery(
  db: SupabaseClient,
  endpointId: string,
  accountId: string,
  event: WebhookEvent,
  payload: unknown
): Promise<string> {
  const deliveryId = randomUUID();
  const { error } = await db.from('webhook_deliveries').insert({
    id: deliveryId,
    endpoint_id: endpointId,
    account_id: accountId,
    event,
    payload,
    attempt: 0,
    status: 'pending',
    next_retry_at: new Date().toISOString(),
  });

  if (error) throw error;
  return deliveryId;
}

export async function processWebhookDeliveryQueue(db: SupabaseClient, batchSize = 50): Promise<number> {
  const now = new Date().toISOString();

  const { data: deliveries, error } = await db
    .from('webhook_deliveries')
    .select('*')
    .eq('status', 'pending')
    .lte('next_retry_at', now)
    .order('next_retry_at', { ascending: true })
    .limit(batchSize);

  if (error || !deliveries) return 0;

  let processed = 0;
  for (const delivery of deliveries as WebhookDelivery[]) {
    const success = await attemptDelivery(db, delivery);
    processed++;
    if (!success && delivery.attempt >= MAX_RETRIES) {
      await markDeliveryFailed(db, delivery.id, 'Max retries exceeded');
    }
  }

  return processed;
}

async function attemptDelivery(db: SupabaseClient, delivery: WebhookDelivery): Promise<boolean> {
  const startTime = Date.now();
  const { data: endpoint } = await db
    .from('webhook_endpoints')
    .select('id, url, secret, is_active')
    .eq('id', delivery.endpoint_id)
    .single();

  if (!endpoint || !endpoint.is_active) {
    await logDelivery(db, delivery, { success: false, errorMessage: 'Endpoint not found or inactive', durationMs: Date.now() - startTime });
    await markDeliveryFailed(db, delivery.id, 'Endpoint not found or inactive');
    return false;
  }

  if (!(await isDeliverableUrl(endpoint.url))) {
    await logDelivery(db, delivery, { success: false, errorMessage: 'SSRF guard blocked delivery', durationMs: Date.now() - startTime });
    await markDeliveryFailed(db, delivery.id, 'SSRF guard blocked delivery');
    return false;
  }

  let secret: string;
  try {
    secret = decrypt(endpoint.secret);
  } catch {
    await logDelivery(db, delivery, { success: false, errorMessage: 'Failed to decrypt secret', durationMs: Date.now() - startTime });
    await markDeliveryFailed(db, delivery.id, 'Failed to decrypt secret');
    return false;
  }

  const payload = JSON.stringify({
    id: delivery.id,
    event: delivery.event,
    occurred_at: new Date().toISOString(),
    account_id: delivery.account_id,
    data: delivery.payload,
  });
  const tsSeconds = Math.floor(Date.now() / 1000);

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacrm-Event': delivery.event,
        'X-Wacrm-Webhook-Id': delivery.endpoint_id,
        'X-Wacrm-Delivery-Id': delivery.id,
        'X-Wacrm-Signature': buildSignatureHeader(payload, secret, tsSeconds),
      },
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    const durationMs = Date.now() - startTime;
    const responseBody = await res.text().catch(() => '');

    if (res.ok) {
      await logDelivery(db, delivery, { success: true, statusCode: res.status, responseBody, durationMs });
      await markDeliverySuccess(db, delivery.id);
      return true;
    }

    await logDelivery(db, delivery, { success: false, statusCode: res.status, responseBody, durationMs });
    throw new Error(`Endpoint responded ${res.status}`);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    await logDelivery(db, delivery, { success: false, errorMessage: errorMsg, durationMs });
    await scheduleRetry(db, delivery, errorMsg);
    return false;
  }
}

interface LogDeliveryParams {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  errorMessage?: string;
  durationMs: number;
}

async function logDelivery(db: SupabaseClient, delivery: WebhookDelivery, params: LogDeliveryParams): Promise<void> {
  await db.from('webhook_delivery_logs').insert({
    delivery_id: delivery.id,
    endpoint_id: delivery.endpoint_id,
    account_id: delivery.account_id,
    event: delivery.event,
    attempt: delivery.attempt + 1,
    status_code: params.success ? params.statusCode : (params.statusCode ?? null),
    response_body: params.responseBody ?? null,
    error_message: params.errorMessage ?? null,
    duration_ms: params.durationMs,
  });
}

async function markDeliverySuccess(db: SupabaseClient, deliveryId: string): Promise<void> {
  const { data: delivery } = await db.from('webhook_deliveries').select('endpoint_id').eq('id', deliveryId).single();

  await db.from('webhook_deliveries').update({
    status: 'delivered',
    updated_at: new Date().toISOString(),
  }).eq('id', deliveryId);

  if (delivery) {
    await db.from('webhook_endpoints').update({
      failure_count: 0,
      last_delivery_at: new Date().toISOString(),
    }).eq('id', delivery.endpoint_id);
  }
}

async function scheduleRetry(db: SupabaseClient, delivery: WebhookDelivery, errorMsg: string): Promise<void> {
  const nextAttempt = delivery.attempt + 1;
  const delayMs = BASE_RETRY_DELAY_MS * Math.pow(2, delivery.attempt);
  const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

  await db.from('webhook_deliveries').update({
    attempt: nextAttempt,
    status: nextAttempt >= MAX_RETRIES ? 'failed' : 'retrying',
    next_retry_at: nextAttempt >= MAX_RETRIES ? null : nextRetryAt,
    last_error: errorMsg,
    updated_at: new Date().toISOString(),
  }).eq('id', delivery.id);

  if (nextAttempt >= MAX_RETRIES) {
    await db.from('webhook_endpoints').update({
      failure_count: nextAttempt,
    }).eq('id', delivery.endpoint_id);
  }
}

async function markDeliveryFailed(db: SupabaseClient, deliveryId: string, errorMsg: string): Promise<void> {
  const { data: delivery } = await db.from('webhook_deliveries').select('endpoint_id').eq('id', deliveryId).single();
  if (delivery) {
    await db.from('webhook_endpoints').update({
      is_active: false,
    }).eq('id', delivery.endpoint_id);
  }
  await db.from('webhook_deliveries').update({
    status: 'failed',
    last_error: errorMsg,
    updated_at: new Date().toISOString(),
  }).eq('id', deliveryId);
}