// ============================================================
// Support Agent — Diagnosis Engine
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DetectionResult,
  DiagnosisResult,
  AutoFixDetails,
} from './types';

export type { DiagnosisResult, AutoFixDetails };

export async function diagnoseIssue(
  db: SupabaseClient,
  event: DetectionResult
): Promise<DiagnosisResult> {
  switch (event.incidentType) {
    case 'webhook_endpoint_disabled':
    case 'webhook_delivery_failing':
      return diagnoseWebhook(db, event);
    case 'message_send_failed':
      return diagnoseMessageSendFailed(db, event);
    case 'meta_api_error':
      return diagnoseMetaApiError(db, event);
    case 'whatsapp_not_configured':
      return diagnoseWhatsAppNotConfigured(db, event);
    case 'cron_not_firing':
      return diagnoseCronNotFiring(db, event);
    case 'automation_stuck':
      return diagnoseAutomationStuck(db, event);
    case 'flow_run_stalled':
      return diagnoseFlowRunStalled(db, event);
    default:
      return {
        rootCause: `Unknown incident type: ${event.incidentType}`,
        category: 'unknown',
        severity: 'low',
        evidence: ['No diagnosis logic for this incident type'],
        recommendedAction: 'human_review',
      };
  }
}

async function diagnoseWebhook(
  db: SupabaseClient,
  event: DetectionResult
): Promise<DiagnosisResult> {
  const { endpoint_id, endpoint_url, failure_count } = event.payload as {
    endpoint_id: string;
    endpoint_url: string;
    failure_count: number;
  };

  const evidence: string[] = [
    `Endpoint has ${failure_count} consecutive failures`,
    `Target URL: ${endpoint_url}`,
  ];

  // Check reachability
  let reachable = false;
  let reachabilityError = '';
  try {
    const response = await fetch(endpoint_url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
      redirect: 'manual',
    });
    reachable = response.ok || response.status === 405 || response.status === 404;
    evidence.push(`Endpoint responded with ${response.status}`);
  } catch (err) {
    reachabilityError = err instanceof Error ? err.message : String(err);
    evidence.push(`Endpoint unreachable: ${reachabilityError}`);
  }

  if (!reachable) {
    // Check if it's a DNS/connection issue vs HTTP error
    const isNetworkError = /ENOTFOUND|ECONNREFUSED|timeout|network/i.test(reachabilityError);
    return {
      rootCause: isNetworkError
        ? 'Webhook endpoint URL is unreachable (DNS/connection failure)'
        : 'Webhook endpoint returned HTTP error',
      category: 'external',
      severity: isNetworkError ? 'high' : 'medium',
      evidence,
      recommendedAction: 'human_review',
    };
  }

  // Endpoint reachable but failing - check recent deliveries
  const { data: logs } = await db
    .from('webhook_delivery_logs')
    .select('status_code, created_at, response_body')
    .eq('endpoint_id', endpoint_id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (logs && logs.length > 0) {
    const serverErrors = logs.filter((l) => (l.status_code ?? 0) >= 500).length;
    const clientErrors = logs.filter((l) => (l.status_code ?? 0) >= 400 && (l.status_code ?? 0) < 500).length;
    evidence.push(`Last ${logs.length} deliveries: ${serverErrors} 5xx, ${clientErrors} 4xx`);

    if (serverErrors > 0) {
      return {
        rootCause: 'Webhook receiver returning 5xx server errors',
        category: 'external',
        severity: 'medium',
        evidence,
        recommendedAction: 'human_review',
      };
    }
    if (clientErrors > 0) {
      return {
        rootCause: 'Webhook receiver returning 4xx client errors (likely payload/signature mismatch)',
        category: 'code',
        severity: 'medium',
        evidence,
        recommendedAction: 'human_review',
      };
    }
  }

  return {
    rootCause: 'Webhook endpoint reachable but failing; cause unclear from available data',
    category: 'unknown',
    severity: 'medium',
    evidence,
    recommendedAction: 'human_review',
  };
}

async function diagnoseMessageSendFailed(
  db: SupabaseClient,
  event: DetectionResult
): Promise<DiagnosisResult> {
  const { message_id, failure_count } = event.payload as {
    message_id: string;
    failure_count: number;
  };

  const evidence: string[] = [`${failure_count} messages failed with meta_error in last 24h`];

  const { data: msg } = await db
    .from('messages')
    .select('content_type, template_name, status, created_at')
    .eq('id', message_id)
    .maybeSingle();

  if (msg) {
    evidence.push(`Failed message type: ${msg.content_type}${msg.template_name ? ` (template: ${msg.template_name})` : ''}`);
  }

  const { data: config } = await db
    .from('whatsapp_config')
    .select('id, phone_number_id, status')
    .eq('account_id', event.accountId)
    .maybeSingle();

  if (!config) {
    return {
      rootCause: 'No WhatsApp configuration for this account',
      category: 'config',
      severity: 'critical',
      evidence: [...evidence, 'No whatsapp_config row found'],
      recommendedAction: 'human_review',
    };
  }

  if (config.status !== 'connected') {
    return {
      rootCause: `WhatsApp config status is "${config.status}", not "connected"`,
      category: 'config',
      severity: 'high',
      evidence: [...evidence, `Config status: ${config.status}`],
      recommendedAction: 'human_review',
    };
  }

  // Check for specific Meta error codes in recent automation logs
  const { data: logs } = await db
    .from('automation_logs')
    .select('error_message, created_at')
    .eq('account_id', event.accountId)
    .ilike('error_message', '%meta%')
    .order('created_at', { ascending: false })
    .limit(10);

  const errorCodes = new Set<string>();
  if (logs) {
    for (const log of logs) {
      const match = (log.error_message || '').match(/\(#(\d+)\)/);
      if (match) errorCodes.add(match[1]);
    }
  }

  if (errorCodes.has('190') || errorCodes.has('102')) {
    return {
      rootCause: 'Meta access token expired or invalid (error #190/#102)',
      category: 'config',
      severity: 'critical',
      evidence: [...evidence, `Detected Meta error codes: ${Array.from(errorCodes).join(', ')}`],
      recommendedAction: 'human_review',
    };
  }

  if (errorCodes.has('131009')) {
    return {
      rootCause: 'Meta API rate limit exceeded (error #131009)',
      category: 'external',
      severity: 'medium',
      evidence: [...evidence, 'Rate limited by Meta'],
      recommendedAction: 'auto_fix',
      fixDetails: {
        type: 'retry_send',
        targetId: message_id,
        params: { backoff: true, maxRetries: 3 },
      },
    };
  }

  if (errorCodes.size > 0) {
    return {
      rootCause: `Meta API returning errors: ${Array.from(errorCodes).join(', ')}`,
      category: 'external',
      severity: 'medium',
      evidence: [...evidence, `Error codes: ${Array.from(errorCodes).join(', ')}`],
      recommendedAction: 'human_review',
    };
  }

  return {
    rootCause: 'Meta API returning errors; specific cause not identified from logs',
    category: 'external',
    severity: 'medium',
    evidence,
    recommendedAction: 'human_review',
  };
}

async function diagnoseMetaApiError(
  db: SupabaseClient,
  event: DetectionResult
): Promise<DiagnosisResult> {
  const { error_codes, sample_errors } = event.payload as {
    error_codes: string[];
    sample_errors: string[];
  };

  const evidence: string[] = [
    `${sample_errors.length} sample errors analyzed`,
    `Error codes found: ${error_codes.join(', ') || 'none'}`,
  ];

  if (error_codes.includes('190') || error_codes.includes('102')) {
    return {
      rootCause: 'Meta access token expired or invalid (error #190/#102)',
      category: 'config',
      severity: 'critical',
      evidence,
      recommendedAction: 'human_review',
    };
  }

  if (error_codes.includes('131009')) {
    return {
      rootCause: 'Meta API rate limit exceeded (error #131009)',
      category: 'external',
      severity: 'medium',
      evidence,
      recommendedAction: 'auto_fix',
      fixDetails: {
        type: 'retry_send',
        targetId: 'rate_limit',
        params: { backoff: true, maxRetries: 3, waitSeconds: 60 },
      },
    };
  }

  if (error_codes.includes('131000') || error_codes.includes('131026')) {
    return {
      rootCause: 'Meta API generic/internal error (may be transient)',
      category: 'external',
      severity: 'medium',
      evidence,
      recommendedAction: 'auto_fix',
      fixDetails: {
        type: 'retry_send',
        targetId: 'generic_meta_error',
        params: { backoff: true, maxRetries: 2, waitSeconds: 30 },
      },
    };
  }

  return {
    rootCause: `Meta API errors with codes: ${error_codes.join(', ') || 'unknown'}`,
    category: 'external',
    severity: 'medium',
    evidence,
    recommendedAction: 'human_review',
  };
}

async function diagnoseWhatsAppNotConfigured(
  db: SupabaseClient,
  event: DetectionResult
): Promise<DiagnosisResult> {
  return {
    rootCause: 'Account has no WhatsApp Business Cloud API configuration',
    category: 'config',
    severity: 'critical',
    evidence: ['No whatsapp_config row found for this account'],
    recommendedAction: 'human_review',
  };
}

async function diagnoseCronNotFiring(
  db: SupabaseClient,
  event: DetectionResult
): Promise<DiagnosisResult> {
  const { pending_count, oldest_run_at, expected_interval_seconds } = event.payload as {
    pending_count: number;
    oldest_run_at: string;
    expected_interval_seconds: number;
  };

  const ageMinutes = Math.round(
    (Date.now() - new Date(oldest_run_at).getTime()) / 60000
  );

  return {
    rootCause: `Automation cron endpoint not hit for ${ageMinutes}+ minutes (expected every ${expected_interval_seconds}s)`,
    category: 'infrastructure',
    severity: 'high',
    evidence: [
      `${pending_count} Wait-step executions overdue`,
      `Oldest pending since: ${oldest_run_at}`,
      `Expected cron interval: ${expected_interval_seconds}s`,
    ],
    recommendedAction: 'human_review',
  };
}

async function diagnoseAutomationStuck(
  db: SupabaseClient,
  event: DetectionResult
): Promise<DiagnosisResult> {
  const { pending_execution_id, automation_id, contact_id, stuck_since, next_step_position } =
    event.payload as {
      pending_execution_id: string;
      automation_id: string;
      contact_id: string | null;
      stuck_since: string;
      next_step_position: number;
    };

  const ageMinutes = Math.round(
    (Date.now() - new Date(stuck_since).getTime()) / 60000
  );

  return {
    rootCause: `Automation execution stuck in 'running' state for ${ageMinutes} min at step ${next_step_position}`,
    category: 'code',
    severity: 'high',
    evidence: [
      `Pending execution ID: ${pending_execution_id}`,
      `Automation ID: ${automation_id}`,
      `Contact ID: ${contact_id ?? 'none'}`,
      `Stuck since: ${stuck_since}`,
      `Next step position: ${next_step_position}`,
    ],
    recommendedAction: 'auto_fix',
    fixDetails: {
      type: 'restart_pending_execution',
      targetId: pending_execution_id,
    },
  };
}

async function diagnoseFlowRunStalled(
  db: SupabaseClient,
  event: DetectionResult
): Promise<DiagnosisResult> {
  const { flow_run_id, flow_id, contact_id, stuck_since, policy_timeout_hours } =
    event.payload as {
      flow_run_id: string;
      flow_id: string;
      contact_id: string;
      stuck_since: string;
      policy_timeout_hours: number;
    };

  const ageHours = Math.round(
    (Date.now() - new Date(stuck_since).getTime()) / (1000 * 60 * 60)
  );

  return {
    rootCause: `Flow run stalled for ${ageHours}h (fallback policy: ${policy_timeout_hours}h timeout)`,
    category: 'code',
    severity: 'medium',
    evidence: [
      `Flow run ID: ${flow_run_id}`,
      `Flow ID: ${flow_id}`,
      `Contact ID: ${contact_id}`,
      `Last advanced: ${stuck_since}`,
      `Policy timeout: ${policy_timeout_hours}h`,
    ],
    recommendedAction: 'auto_fix',
    fixDetails: {
      type: 'clear_stuck_execution',
      targetId: flow_run_id,
      params: { markTimedOut: true },
    },
  };
}