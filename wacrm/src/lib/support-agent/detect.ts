import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import type { DetectionResult, IncidentType } from './types';

export type { DetectionResult, IncidentType };

const THRESHOLDS = {
  webhookFailureThreshold: 15,
  cronMissedIntervalSeconds: 300,
  automationStuckThresholdMinutes: 10,
  flowRunStalledThresholdMinutes: 30,
} as const;

export async function detectAllIssues(): Promise<DetectionResult[]> {
  const db = supabaseAdmin();
  const results: DetectionResult[] = [];

  // Run all detectors in parallel
  await Promise.allSettled([
    detectDisabledWebhookEndpoints(db, results),
    detectFailingWebhookEndpoints(db, results),
    detectFailedMessageSends(db, results),
    detectMetaApiErrors(db, results),
    detectUnconfiguredWhatsApp(db, results),
    detectCronNotFiring(db, results),
    detectStuckAutomations(db, results),
    detectStalledFlowRuns(db, results),
  ]);

  return results;
}

async function detectDisabledWebhookEndpoints(
  db: SupabaseClient,
  out: DetectionResult[]
): Promise<void> {
  const { data, error } = await db
    .from('webhook_endpoints')
    .select('id, account_id, url, failure_count, last_delivery_at, updated_at')
    .eq('is_active', false)
    .gte('failure_count', THRESHOLDS.webhookFailureThreshold);

  if (error || !data) return;

  for (const row of data) {
    const disabledAt = new Date(row.updated_at);
    if (Date.now() - disabledAt.getTime() > 24 * 60 * 60 * 1000) continue;

    out.push({
      incidentType: 'webhook_endpoint_disabled',
      accountId: row.account_id,
      summary: `Webhook endpoint auto-disabled after ${row.failure_count} consecutive failures`,
      payload: {
        endpoint_id: row.id,
        endpoint_url: row.url,
        failure_count: row.failure_count,
        last_delivery_at: row.last_delivery_at,
      },
      detectedAt: new Date().toISOString(),
    });
  }
}

async function detectFailingWebhookEndpoints(
  db: SupabaseClient,
  out: DetectionResult[]
): Promise<void> {
  const { data, error } = await db
    .from('webhook_endpoints')
    .select('id, account_id, url, failure_count, last_delivery_at')
    .eq('is_active', true)
    .gte('failure_count', 10);

  if (error || !data) return;

  for (const row of data) {
    out.push({
      incidentType: 'webhook_delivery_failing',
      accountId: row.account_id,
      summary: `Webhook endpoint at ${row.failure_count}/15 consecutive failures`,
      payload: {
        endpoint_id: row.id,
        endpoint_url: row.url,
        failure_count: row.failure_count,
        last_delivery_at: row.last_delivery_at,
      },
      detectedAt: new Date().toISOString(),
    });
  }
}

async function detectFailedMessageSends(
  db: SupabaseClient,
  out: DetectionResult[]
): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('messages')
    .select('id, account_id, conversation_id, contact_id, content_type, template_name')
    .eq('status', 'failed')
    .gte('created_at', since);

  if (error || !data) return;

  const byAccount = new Map<string, typeof data>();
  for (const msg of data) {
    const key = msg.account_id;
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(msg);
  }

  for (const [accountId, messages] of byAccount) {
    if (messages.length < 3) continue;

    const sample = messages[0];
    out.push({
      incidentType: 'message_send_failed',
      accountId,
      summary: `${messages.length} outbound messages failed (meta_error) in last 24h`,
      payload: {
        message_id: sample.id,
        conversation_id: sample.conversation_id,
        contact_id: sample.contact_id,
        failure_count: messages.length,
      },
      detectedAt: new Date().toISOString(),
    });
  }
}

async function detectMetaApiErrors(
  db: SupabaseClient,
  out: DetectionResult[]
): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('automation_logs')
    .select('id, automation_id, account_id, error_message, steps_executed, created_at')
    .eq('status', 'failed')
    .gte('created_at', since)
    .ilike('error_message', '%meta%');

  if (error || !data) return;

  const byAccount = new Map<string, typeof data>();
  for (const log of data) {
    const key = log.account_id;
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(log);
  }

  for (const [accountId, logs] of byAccount) {
    if (logs.length < 2) continue;

    const errorCodes = new Set<string>();
    for (const log of logs) {
      const msg = log.error_message || '';
      const match = msg.match(/\(#(\d+)\)/);
      if (match) errorCodes.add(match[1]);
    }

    out.push({
      incidentType: 'meta_api_error',
      accountId,
      summary: `${logs.length} automation failures with Meta API errors in last hour`,
      payload: {
        error_codes: Array.from(errorCodes),
        sample_errors: logs.slice(0, 3).map((l) => l.error_message),
      },
      detectedAt: new Date().toISOString(),
    });
  }
}

async function detectUnconfiguredWhatsApp(
  db: SupabaseClient,
  out: DetectionResult[]
): Promise<void> {
  // Accounts with no whatsapp_config
  const { data, error } = await db
    .from('accounts')
    .select('id, name')
    .not('id', 'in', `(SELECT DISTINCT account_id FROM whatsapp_config)`);

  if (error || !data) return;

  for (const acc of data) {
    out.push({
      incidentType: 'whatsapp_not_configured',
      accountId: acc.id,
      summary: `Account "${acc.name}" has no WhatsApp configuration`,
      payload: {},
      detectedAt: new Date().toISOString(),
    });
  }

  // Configs with undecryptable tokens
  const { data: configs, error: configErr } = await db
    .from('whatsapp_config')
    .select('id, account_id, access_token');

  if (configErr || !configs) return;

  for (const cfg of configs) {
    try {
      const { decrypt } = await import('@/lib/whatsapp/encryption');
      decrypt(cfg.access_token);
    } catch {
      out.push({
        incidentType: 'meta_api_error',
        accountId: cfg.account_id,
        summary: `WhatsApp config has undecryptable access token`,
        payload: {
          whatsapp_config_id: cfg.id,
          error_code: 'decrypt_failed',
        },
        detectedAt: new Date().toISOString(),
      });
    }
  }
}

async function detectCronNotFiring(
  db: SupabaseClient,
  out: DetectionResult[]
): Promise<void> {
  const staleThreshold = new Date(Date.now() - THRESHOLDS.cronMissedIntervalSeconds * 1000).toISOString();

  const { data, error } = await db
    .from('automation_pending_executions')
    .select('id, account_id, automation_id, run_at, status, created_at')
    .eq('status', 'pending')
    .lte('run_at', staleThreshold)
    .order('run_at', { ascending: true })
    .limit(100);

  if (error || !data || data.length === 0) return;

  const byAccount = new Map<string, typeof data>();
  for (const row of data) {
    const key = row.account_id;
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(row);
  }

  for (const [accountId, rows] of byAccount) {
    const oldestRunAt = rows[0].run_at;
    const ageMinutes = Math.round((Date.now() - new Date(oldestRunAt).getTime()) / 60000);

    out.push({
      incidentType: 'cron_not_firing',
      accountId,
      summary: `${rows.length} automation Wait steps overdue by ${ageMinutes}+ minutes (cron may not be firing)`,
      payload: {
        pending_count: rows.length,
        oldest_run_at: oldestRunAt,
        expected_interval_seconds: 60,
      },
      detectedAt: new Date().toISOString(),
    });
  }
}

async function detectStuckAutomations(
  db: SupabaseClient,
  out: DetectionResult[]
): Promise<void> {
  const stuckThreshold = new Date(Date.now() - THRESHOLDS.automationStuckThresholdMinutes * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('automation_pending_executions')
    .select('id, account_id, automation_id, contact_id, status, run_at, created_at, next_step_position')
    .eq('status', 'running')
    .lte('created_at', stuckThreshold);

  if (error || !data) return;

  for (const row of data) {
    out.push({
      incidentType: 'automation_stuck',
      accountId: row.account_id,
      summary: `Automation execution stuck in 'running' for >${THRESHOLDS.automationStuckThresholdMinutes} min (step ${row.next_step_position})`,
      payload: {
        pending_execution_id: row.id,
        automation_id: row.automation_id,
        contact_id: row.contact_id,
        stuck_since: row.created_at,
        next_step_position: row.next_step_position,
      },
      detectedAt: new Date().toISOString(),
    });
  }
}

async function detectStalledFlowRuns(
  db: SupabaseClient,
  out: DetectionResult[]
): Promise<void> {
  const threshold = new Date(Date.now() - THRESHOLDS.flowRunStalledThresholdMinutes * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('flow_runs')
    .select('id, account_id, flow_id, contact_id, last_advanced_at, status, flows ( fallback_policy )')
    .eq('status', 'active')
    .lte('last_advanced_at', threshold);

  if (error || !data) return;

  for (const row of data) {
    const flowsField = Array.isArray(row.flows) ? row.flows[0] : row.flows;
    const policy = flowsField?.fallback_policy;
    const timeoutHours = policy?.on_timeout_hours ?? 24;

    const lastAdvanced = new Date(row.last_advanced_at).getTime();
    const ageHours = (Date.now() - lastAdvanced) / (1000 * 60 * 60);

    if (ageHours >= timeoutHours) {
      out.push({
        incidentType: 'flow_run_stalled',
        accountId: row.account_id,
        summary: `Flow run stalled for ${Math.round(ageHours)}h (policy: ${timeoutHours}h)`,
        payload: {
          flow_run_id: row.id,
          flow_id: row.flow_id,
          contact_id: row.contact_id,
          stuck_since: row.last_advanced_at,
          policy_timeout_hours: timeoutHours,
        },
        detectedAt: new Date().toISOString(),
      });
    }
  }
}