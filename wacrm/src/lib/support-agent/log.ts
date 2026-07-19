// ============================================================
// Support Agent — Incident Logging
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DetectionResult,
  DiagnosisResult,
  FixResult,
  IncidentType,
} from './types';

export interface LogIncidentInput {
  accountId: string;
  incidentType: IncidentType;
  summary: string;
  payload: Record<string, unknown>;
  diagnosis: DiagnosisResult | null;
  actionTaken: string | null;
  actionResult: FixResult | null;
  status: 'open' | 'auto_fixed' | 'flagged_for_review' | 'resolved_manually';
}

export interface IncidentLogRow {
  id: string;
  account_id: string;
  incident_type: IncidentType;
  summary: string;
  payload: Record<string, unknown>;
  root_cause: string | null;
  action_taken: string | null;
  fix_action: string | null;
  status: 'detected' | 'diagnosed' | 'auto_fixed' | 'flagged_for_review' | 'manual_review_resolved';
  created_at: string;
  resolved_at: string | null;
}

export async function logIncident(
  db: SupabaseClient,
  input: LogIncidentInput
): Promise<string> {
  const { data, error } = await db
    .from('incident_logs')
    .insert({
      account_id: input.accountId,
      incident_type: input.incidentType,
      summary: input.summary,
      payload: input.payload,
      root_cause: input.diagnosis?.rootCause ?? null,
      action_taken: input.actionTaken,
      fix_action: input.actionResult
        ? `${input.actionResult.actionTaken}:${input.actionResult.success ? 'success' : 'failed'}`
        : null,
      status: mapStatus(input.status),
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[support-agent] Failed to log incident:', error);
    throw new Error(`Failed to log incident: ${error?.message}`);
  }

  return data.id;
}

function mapStatus(
  status: 'open' | 'auto_fixed' | 'flagged_for_review' | 'resolved_manually'
): 'detected' | 'diagnosed' | 'auto_fixed' | 'flagged_for_review' | 'manual_review_resolved' {
  switch (status) {
    case 'open':
      return 'detected';
    case 'auto_fixed':
      return 'auto_fixed';
    case 'flagged_for_review':
      return 'flagged_for_review';
    case 'resolved_manually':
      return 'manual_review_resolved';
  }
}

export async function getIncidentsForAccount(
  db: SupabaseClient,
  accountId: string,
  limit = 50,
  status?: string
): Promise<IncidentLogRow[]> {
  let query = db
    .from('incident_logs')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[support-agent] Failed to fetch incidents:', error);
    return [];
  }
  return (data ?? []) as IncidentLogRow[];
}

export async function resolveIncident(
  db: SupabaseClient,
  incidentId: string,
  resolvedBy: string,
  resolutionNote?: string
): Promise<void> {
  const { error } = await db
    .from('incident_logs')
    .update({
      status: 'manual_review_resolved',
      resolved_at: new Date().toISOString(),
      // Could add resolution_note column if needed
    })
    .eq('id', incidentId);

  if (error) {
    console.error('[support-agent] Failed to resolve incident:', error);
    throw new Error(`Failed to resolve incident: ${error.message}`);
  }
}