// ============================================================
// Support Agent — Shared Types
// ============================================================

export interface DetectionResult {
  incidentType: IncidentType;
  accountId: string;
  summary: string;
  payload: Record<string, unknown>;
  detectedAt: string;
}

export type IncidentType =
  | 'webhook_delivery_failing'
  | 'webhook_endpoint_disabled'
  | 'message_send_failed'
  | 'meta_api_error'
  | 'whatsapp_not_configured'
  | 'cron_not_firing'
  | 'automation_stuck'
  | 'flow_run_stalled';

export interface DiagnosisResult {
  rootCause: string;
  category: 'config' | 'external' | 'code' | 'infrastructure' | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidence: string[];
  recommendedAction: 'auto_fix' | 'human_review';
  fixDetails?: AutoFixDetails;
}

export interface AutoFixDetails {
  type: 'reenable_webhook' | 'retry_send' | 'restart_pending_execution' | 'clear_stuck_execution';
  targetId: string;
  params?: Record<string, unknown>;
}

export interface FixAction {
  type: AutoFixDetails['type'];
  targetId: string;
  metadata?: Record<string, unknown>;
}

export interface FixResult {
  success: boolean;
  actionTaken: string;
  details?: string;
  error?: string;
}

export interface FixDetails extends AutoFixDetails {}

export interface IncidentLogRow {
  id: string;
  account_id: string;
  incident_type: IncidentType;
  summary: string;
  payload: Record<string, unknown>;
  diagnosis: DiagnosisResult | null;
  action_taken: string | null;
  action_result: FixResult | null;
  status: 'open' | 'auto_fixed' | 'flagged_for_review' | 'resolved_manually';
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}