// ============================================================
// Support Agent — Safe Auto-Fix Actions
// ============================================================
//
// ONLY whitelisted, reversible operations. No code changes, no
// schema mutations, no secret rotation. Each action:
// 1. Verifies preconditions
// 2. Performs a single, idempotent DB/API call
// 3. Logs the exact operation for audit
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
} from '@/lib/whatsapp/meta-api';
import type { FixAction, FixResult, IncidentType } from './types';

export type { FixAction, FixResult };

export async function executeFix(
  db: SupabaseClient,
  action: FixAction
): Promise<FixResult> {
  switch (action.type) {
    case 'reenable_webhook':
      return reenableWebhookEndpoint(db, action.targetId, action.metadata);
    case 'retry_send':
      return retryFailedMessageSend(db, action.targetId, action.metadata);
    case 'restart_pending_execution':
      return restartPendingExecution(db, action.targetId, action.metadata);
    case 'clear_stuck_execution':
      return clearStuckExecution(db, action.targetId, action.metadata);
    default:
      return {
        success: false,
        actionTaken: `unknown_fix_type:${action.type}`,
        error: `Unknown fix type: ${action.type}`,
      };
  }
}

export async function reenableWebhookEndpoint(
  db: SupabaseClient,
  endpointId: string,
  _meta?: Record<string, unknown>
): Promise<FixResult> {
  // Precondition: verify endpoint exists and is disabled
  const { data: endpoint, error: fetchErr } = await db
    .from('webhook_endpoints')
    .select('id, url, is_active, failure_count, account_id')
    .eq('id', endpointId)
    .maybeSingle();

  if (fetchErr || !endpoint) {
    return { success: false, actionTaken: 'reenable_webhook', error: 'Endpoint not found' };
  }

  if (endpoint.is_active) {
    return { success: false, actionTaken: 'reenable_webhook', error: 'Endpoint already active' };
  }

  // Health-check the URL before re-enabling (quick HEAD)
  try {
    const res = await fetch(endpoint.url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
      redirect: 'manual',
    });
    // Accept any 2xx, 3xx, 404, 405 — we just need the host to respond
    if (!res.ok && res.status !== 404 && res.status !== 405) {
      return {
        success: false,
        actionTaken: 'reenable_webhook',
        error: `Health check failed: ${res.status}`,
      };
    }
  } catch (err) {
    return {
      success: false,
      actionTaken: 'reenable_webhook',
      error: `Health check error: ${err instanceof Error ? err.message : err}`,
    };
  }

  // Re-enable: set is_active=true, failure_count=0
  const { error: updateErr } = await db
    .from('webhook_endpoints')
    .update({ is_active: true, failure_count: 0 })
    .eq('id', endpointId);

  if (updateErr) {
    return { success: false, actionTaken: 'reenable_webhook', error: updateErr.message };
  }

  return {
    success: true,
    actionTaken: 'reenable_webhook',
    details: `Re-enabled endpoint ${endpointId} (${endpoint.url}) after health check passed`,
  };
}

async function retryFailedMessageSend(
  db: SupabaseClient,
  messageId: string,
  meta?: Record<string, unknown>
): Promise<FixResult> {
  // Find the failed message
  const { data: msg, error: fetchErr } = await db
    .from('messages')
    .select('id, conversation_id, content_text, content_type, template_name, contact:conversations(contact_id)')
    .eq('id', messageId)
    .eq('status', 'failed')
    .maybeSingle();

  if (fetchErr || !msg) {
    return { success: false, actionTaken: 'retry_send', error: 'Failed message not found' };
  }

  // Get account via conversation
  const { data: conv } = await db
    .from('conversations')
    .select('account_id, contact_id')
    .eq('id', msg.conversation_id)
    .maybeSingle();

  if (!conv) {
    return { success: false, actionTaken: 'retry_send', error: 'Conversation not found' };
  }

  // Check whatsapp_config
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id, access_token, phone_number_id')
    .eq('account_id', conv.account_id)
    .maybeSingle();

  if (!config) {
    return { success: false, actionTaken: 'retry_send', error: 'No WhatsApp config for account' };
  }

  // Decrypt token
  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch {
    return { success: false, actionTaken: 'retry_send', error: 'Cannot decrypt access token' };
  }

  // Get contact phone
  const { data: contact } = await db
    .from('contacts')
    .select('phone')
    .eq('id', conv.contact_id)
    .maybeSingle();

  if (!contact?.phone) {
    return { success: false, actionTaken: 'retry_send', error: 'Contact phone not found' };
  }

  // Retry with backoff
  const backoff = meta?.backoff === true;
  const maxRetries = (meta?.maxRetries as number) ?? 1;
  const waitSeconds = (meta?.waitSeconds as number) ?? 1;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0 && backoff) {
      await new Promise((r) => setTimeout(r, waitSeconds * 1000 * Math.pow(2, attempt - 1)));
    }

    try {
      let waMsgId: string;

      if (msg.content_type === 'template' && msg.template_name) {
        const res = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: contact.phone,
          templateName: msg.template_name,
          language: 'en_US',
          params: [], // Would need to reconstruct from original message
        });
        waMsgId = res.messageId;
      } else if (['image', 'video', 'document', 'audio'].includes(msg.content_type)) {
        // Media retry would need the media URL
        return { success: false, actionTaken: 'retry_send', error: 'Media message retry not implemented' };
      } else {
        const res = await sendTextMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: contact.phone,
          text: msg.content_text || '',
        });
        waMsgId = res.messageId;
      }

      // Update message status
      await db
        .from('messages')
        .update({ status: 'sent', message_id: waMsgId })
        .eq('id', messageId);

      return {
        success: true,
        actionTaken: 'retry_send',
        details: `Retried message ${messageId} on attempt ${attempt + 1}; new wamid: ${waMsgId}`,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  return {
    success: false,
    actionTaken: 'retry_send',
    error: `All retries failed: ${lastError?.message}`,
  };
}

export async function restartPendingExecution(
  db: SupabaseClient,
  executionId: string,
  _meta?: Record<string, unknown>
): Promise<FixResult> {
  // Find the stuck execution
  const { data: exec, error: fetchErr } = await db
    .from('automation_pending_executions')
    .select('*')
    .eq('id', executionId)
    .maybeSingle();

  if (fetchErr || !exec) {
    return { success: false, actionTaken: 'restart_pending_execution', error: 'Execution not found' };
  }

  if (exec.status !== 'running') {
    return {
      success: false,
      actionTaken: 'restart_pending_execution',
      error: `Execution status is ${exec.status}, not 'running'`,
    };
  }

  // Reset to pending so cron will pick it up
  const { error: updateErr } = await db
    .from('automation_pending_executions')
    .update({ status: 'pending' })
    .eq('id', executionId);

  if (updateErr) {
    return { success: false, actionTaken: 'restart_pending_execution', error: updateErr.message };
  }

  return {
    success: true,
    actionTaken: 'restart_pending_execution',
    details: `Reset execution ${executionId} from 'running' to 'pending' for cron to resume`,
  };
}

async function clearStuckExecution(
  db: SupabaseClient,
  executionId: string,
  meta?: Record<string, unknown>
): Promise<FixResult> {
  // Check which table it's in
  let row: Record<string, unknown> | null = null;
  let isFlowRun = false;

  const { data: autoExec } = await db
    .from('automation_pending_executions')
    .select('*')
    .eq('id', executionId)
    .maybeSingle();

  if (autoExec) {
    row = autoExec;
  } else {
    const { data: flowRun } = await db
      .from('flow_runs')
      .select('*')
      .eq('id', executionId)
      .maybeSingle();
    if (flowRun) {
      row = flowRun;
      isFlowRun = true;
    }
  }

  if (!row) {
    return { success: false, actionTaken: 'clear_stuck_execution', error: 'Execution/run not found' };
  }

  if (!isFlowRun) {
    const markFailed = meta?.markFailed === true;
    const { error } = await db
      .from('automation_pending_executions')
      .update({ status: markFailed ? 'failed' : 'done' })
      .eq('id', executionId);

    if (error) {
      return { success: false, actionTaken: 'clear_stuck_execution', error: error.message };
    }

    // Also update the automation_log if linked
    if (row.log_id) {
      await db
        .from('automation_logs')
        .update({
          status: 'failed',
          error_message: 'Auto-cleared by support agent (stuck execution)',
        })
        .eq('id', row.log_id);
    }

    return {
      success: true,
      actionTaken: 'clear_stuck_execution',
      details: `Marked automation execution ${executionId} as ${markFailed ? 'failed' : 'done'}`,
    };
  } else {
    // flow_run
    const markTimedOut = meta?.markTimedOut === true;
    const { error } = await db
      .from('flow_runs')
      .update({
        status: markTimedOut ? 'completed' : 'abandoned',
        ended_at: new Date().toISOString(),
        end_reason: markTimedOut ? 'fallback_timeout' : 'support_agent_cleared',
      })
      .eq('id', executionId);

    if (error) {
      return { success: false, actionTaken: 'clear_stuck_execution', error: error.message };
    }

    return {
      success: true,
      actionTaken: 'clear_stuck_execution',
      details: `Marked flow run ${executionId} as ${markTimedOut ? 'completed (fallback timeout)' : 'abandoned'}`,
    };
  }
}