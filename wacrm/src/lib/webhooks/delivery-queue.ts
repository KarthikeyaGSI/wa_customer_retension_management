// ============================================================
// Webhook Delivery Queue — BullMQ with exponential backoff + DLQ
// ============================================================
//
// Replaces single-attempt fire-and-forget with durable queue.
// Jobs survive restarts, retry with exponential backoff,
// and land in DLQ after max retries.
//
// Requires: REDIS_URL env var
// ============================================================

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { getRedis } from '../redis';
import type { WebhookEvent } from '@/lib/webhooks/events';

export interface WebhookDeliveryJob {
  deliveryId: string;
  endpointId: string;
  accountId: string;
  event: WebhookEvent;
  payload: unknown;
  attempt: number;
}

const QUEUE_NAME = 'webhook-deliveries';
const DLQ_NAME = 'webhook-deliveries-dlq';

const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // 2s, 4s, 8s, 16s, 32s
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

let _queue: Queue<WebhookDeliveryJob> | null = null;
let _dlq: Queue<WebhookDeliveryJob> | null = null;
let _worker: Worker<WebhookDeliveryJob> | null = null;

export function getWebhookQueue(): Queue<WebhookDeliveryJob> {
  if (!_queue) {
    const redis = getRedis();
    _queue = new Queue<WebhookDeliveryJob>(QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
  }
  return _queue;
}

export function getDLQ(): Queue<WebhookDeliveryJob> {
  if (!_dlq) {
    const redis = getRedis();
    _dlq = new Queue<WebhookDeliveryJob>(DLQ_NAME, {
      connection: redis,
    });
  }
  return _dlq;
}

export async function enqueueWebhookDelivery(
  deliveryId: string,
  endpointId: string,
  accountId: string,
  event: WebhookEvent,
  payload: unknown,
): Promise<string> {
  const queue = getWebhookQueue();
  const job = await queue.add('deliver', {
    deliveryId,
    endpointId,
    accountId,
    event,
    payload,
    attempt: 0,
  } as WebhookDeliveryJob);
  return job.id!;
}

async function processDelivery(job: Job<WebhookDeliveryJob>): Promise<void> {
  const { deliveryId, endpointId, accountId, event, payload, attempt } = job.data;
  
  // Import dynamically to avoid circular deps
  const { supabaseAdmin } = await import('@/lib/automations/admin-client');
  const { dispatchWebhookEvent } = await import('@/lib/webhooks/deliver');
  const { decrypt } = await import('@/lib/whatsapp/encryption');
  const { isDeliverableUrl } = await import('@/lib/webhooks/ssrf');
  const { buildSignatureHeader } = await import('@/lib/webhooks/sign');

  const db = supabaseAdmin();

  // Get endpoint
  const { data: endpoint, error: fetchErr } = await db
    .from('webhook_endpoints')
    .select('id, url, secret, is_active')
    .eq('id', endpointId)
    .single();

  if (fetchErr || !endpoint || !endpoint.is_active) {
    throw new Error('Endpoint not found or inactive');
  }

  // SSRF check
  if (!(await isDeliverableUrl(endpoint.url))) {
    throw new Error('SSRF guard blocked delivery');
  }

  // Decrypt secret
  let secret: string;
  try {
    secret = decrypt(endpoint.secret);
  } catch {
    throw new Error('Failed to decrypt secret');
  }

  // Build payload
  const rawBody = JSON.stringify({
    id: deliveryId,
    event,
    occurred_at: new Date().toISOString(),
    account_id: accountId,
    data: payload,
  });
  const tsSeconds = Math.floor(Date.now() / 1000);

  // Attempt delivery
  const startTime = Date.now();
  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacrm-Event': event,
        'X-Wacrm-Webhook-Id': endpointId,
        'X-Wacrm-Delivery-Id': deliveryId,
        'X-Wacrm-Signature': buildSignatureHeader(rawBody, secret, tsSeconds),
      },
      body: rawBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });

    const durationMs = Date.now() - startTime;

    if (res.ok) {
      // Success - log and mark delivered
      await logDelivery(db, deliveryId, endpoint.id, accountId, event, attempt + 1, {
        success: true,
        statusCode: res.status,
        durationMs,
      });
      
      await db
        .from('webhook_endpoints')
        .update({ failure_count: 0, last_delivery_at: new Date().toISOString() })
        .eq('id', endpoint.id);
        
      return;
    }

    // HTTP error - will retry
    const errorMsg = `Endpoint responded ${res.status}`;
    await logDelivery(db, deliveryId, endpoint.id, accountId, event, attempt + 1, {
      success: false,
      statusCode: res.status,
      errorMessage: errorMsg,
      durationMs,
    });
    
    throw new Error(errorMsg);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    await logDelivery(db, deliveryId, endpoint.id, accountId, event, attempt + 1, {
      success: false,
      errorMessage: errorMsg,
      durationMs,
    });

    // Check if we should retry or move to DLQ
    const maxAttempts = job.opts.attempts ?? 5;
    if (attempt + 1 >= maxAttempts) {
      // Move to DLQ
      await moveToDLQ(job, errorMsg);
    }
    throw err; // BullMQ will handle retry
  }
}

async function logDelivery(
  db: any,
  deliveryId: string,
  endpointId: string,
  accountId: string,
  event: string,
  attempt: number,
  params: {
    success: boolean;
    statusCode?: number;
    errorMessage?: string;
    responseBody?: string;
    durationMs: number;
  }
): Promise<void> {
  await db.from('webhook_delivery_logs').insert({
    delivery_id: deliveryId,
    endpoint_id: endpointId,
    account_id: accountId,
    event,
    attempt,
    status_code: params.success ? params.statusCode : null,
    response_body: params.responseBody ?? null,
    error_message: params.errorMessage ?? null,
    duration_ms: params.durationMs,
  });
}

async function moveToDLQ(job: Job<WebhookDeliveryJob>, errorMsg: string): Promise<void> {
  const dlq = getDLQ();
  await dlq.add('dlq', {
    ...job.data,
  });
  
  // Also update the original delivery record
  const { supabaseAdmin } = await import('@/lib/automations/admin-client');
  const db = supabaseAdmin();
  await db.from('webhook_deliveries').update({
    status: 'failed',
    last_error: errorMsg,
    updated_at: new Date().toISOString(),
  }).eq('id', job.data.deliveryId);
}

// Start the worker
export function startWebhookDeliveryWorker(): void {
  if (_worker) return;
  
  const redis = getRedis();
  _worker = new Worker<WebhookDeliveryJob>(QUEUE_NAME, processDelivery, {
    connection: redis,
    concurrency: 10,
    limiter: { max: 50, duration: 1000 }, // 50 jobs/sec max
  });

  _worker.on('completed', (job) => {
    console.log(`[webhook-queue] Job ${job.id} completed`);
  });
  
  _worker.on('failed', (job, err) => {
    console.error(`[webhook-queue] Job ${job?.id} failed:`, err.message);
  });

  // Also track queue events
  const queueEvents = new QueueEvents(QUEUE_NAME, { connection: getRedis() });
  queueEvents.on('failed', ({ jobId, failedReason }) => {
    console.error(`[webhook-queue] Job ${jobId} failed:`, failedReason);
  });
}

export async function stopWebhookDeliveryWorker(): Promise<void> {
  await _worker?.close();
  await _queue?.close();
  await getDLQ().close();
  _worker = null;
  _queue = null;
  _dlq = null;
}

// Manual retry endpoint helper
export async function retryFailedDelivery(deliveryId: string): Promise<void> {
  const queue = getWebhookQueue();
  const dlq = getDLQ();
  
  // Check main queue first
  let job = await queue.getJob(deliveryId);
  if (job) {
    await job.retry();
    return;
  }
  
  // Check DLQ
  job = await dlq.getJob(deliveryId);
  if (job) {
    await queue.add('deliver', job.data, {
      jobId: job.id,
      attempts: job.opts.attempts ?? 3,
      backoff: job.opts.backoff,
      delay: 0,
    });
    await job.remove();
    return;
  }
  
  throw new Error('Delivery not found');
}

export async function getDeliveryStatus(deliveryId: string): Promise<{
  status: string;
  attempts: number;
  lastError?: string;
  nextRetryAt?: string;
} | null> {
  const queue = getWebhookQueue();
  const dlq = getDLQ();
  
  let job = await queue.getJob(deliveryId);
  if (job) {
    const state = await job.getState();
    return {
      status: state,
      attempts: job.attemptsMade,
    };
  }
  
  job = await dlq.getJob(deliveryId);
  if (job) {
    return {
      status: 'dead',
      attempts: job.attemptsMade,
      lastError: job.failedReason,
    };
  }
  
  return null;
}