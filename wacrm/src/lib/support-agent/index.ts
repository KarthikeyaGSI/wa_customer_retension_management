// ============================================================
// Support Agent — Main Orchestrator
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { detectAllIssues, type DetectionResult } from './detect';
import { diagnoseIssue, type DiagnosisResult } from './diagnose';
import { executeFix, type FixResult } from './fix';
import { logIncident } from './log';

export interface SupportAgentRunResult {
  detections: DetectionResult[];
  diagnoses: (DetectionResult & { diagnosis: DiagnosisResult })[];
  fixes: (DetectionResult & { diagnosis: DiagnosisResult; fix: FixResult })[];
  flagged: (DetectionResult & { diagnosis: DiagnosisResult })[];
  errors: string[];
}

export async function runSupportAgentCheck(): Promise<SupportAgentRunResult> {
  const db = supabaseAdmin();
  const errors: string[] = [];

  // 1. DETECT - Find all current issues
  let detections: DetectionResult[] = [];
  try {
    detections = await detectAllIssues();
  } catch (err) {
    errors.push(`Detection failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. DIAGNOSE - For each detection, determine root cause
  const diagnoses: (DetectionResult & { diagnosis: DiagnosisResult })[] = [];
  for (const detection of detections) {
    try {
      const diagnosis = await diagnoseIssue(db, detection);
      diagnoses.push({ ...detection, diagnosis });
    } catch (err) {
      errors.push(`Diagnosis failed for ${detection.incidentType}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. AUTO-FIX - Execute safe, reversible fixes where appropriate
  const fixes: (DetectionResult & { diagnosis: DiagnosisResult; fix: FixResult })[] = [];
  for (const det of diagnoses) {
    if (det.diagnosis.recommendedAction !== 'auto_fix') continue;
    if (!det.diagnosis.fixDetails) continue;

    try {
      const fix = await executeFix(db, {
        type: det.diagnosis.fixDetails.type,
        targetId: det.diagnosis.fixDetails.targetId,
        metadata: det.diagnosis.fixDetails.params,
      });
      fixes.push({ ...det, fix });

      // Log the auto-fix
      await logIncident(db, {
        accountId: det.accountId,
        incidentType: det.incidentType,
        summary: `Auto-fixed: ${det.summary}`,
        payload: det.payload,
        diagnosis: det.diagnosis,
        actionTaken: fix.actionTaken,
        actionResult: fix,
        status: fix.success ? 'auto_fixed' : 'flagged_for_review',
      });
    } catch (err) {
      errors.push(`Fix failed for ${det.incidentType}: ${err instanceof Error ? err.message : String(err)}`);
      // Still log the attempt
      await logIncident(db, {
        accountId: det.accountId,
        incidentType: det.incidentType,
        summary: `Auto-fix attempted but failed: ${det.summary}`,
        payload: det.payload,
        diagnosis: det.diagnosis,
        actionTaken: 'auto_fix_failed',
        actionResult: { success: false, actionTaken: 'auto_fix', error: String(err) },
        status: 'flagged_for_review',
      });
    }
  }

  // 4. FLAG FOR REVIEW - Everything not auto-fixed
  const flagged: (DetectionResult & { diagnosis: DiagnosisResult })[] = [];
  for (const det of diagnoses) {
    const wasFixed = fixes.some(f => f.incidentType === det.incidentType && f.accountId === det.accountId && f.fix.success);
    if (wasFixed) continue;

    if (det.diagnosis.recommendedAction === 'human_review' || det.diagnosis.severity === 'critical') {
      await logIncident(db, {
        accountId: det.accountId,
        incidentType: det.incidentType,
        summary: `Flagged for review: ${det.summary}`,
        payload: det.payload,
        diagnosis: det.diagnosis,
        actionTaken: null,
        actionResult: null,
        status: 'flagged_for_review',
      });
      flagged.push(det);
    }
  }

  return { detections, diagnoses, fixes, flagged, errors };
}

// Helper to run a single incident through the full pipeline (for testing/debugging)
export async function processIncident(
  db: SupabaseClient,
  incidentType: DetectionResult['incidentType'],
  accountId: string,
  payload: Record<string, unknown>
): Promise<{ detection: DetectionResult; diagnosis: DiagnosisResult; fix?: FixResult }> {
  const detection: DetectionResult = {
    incidentType,
    accountId,
    summary: `Manual check: ${incidentType}`,
    payload,
    detectedAt: new Date().toISOString(),
  };

  const diagnosis = await diagnoseIssue(db, detection);

  let fix: FixResult | undefined;
  if (diagnosis.recommendedAction === 'auto_fix' && diagnosis.fixDetails) {
    fix = await executeFix(db, {
      type: diagnosis.fixDetails.type,
      targetId: diagnosis.fixDetails.targetId,
      metadata: diagnosis.fixDetails.params,
    });
  }

  await logIncident(db, {
    accountId,
    incidentType,
    summary: `Manual process: ${incidentType}`,
    payload,
    diagnosis,
    actionTaken: fix?.actionTaken ?? null,
    actionResult: fix ?? null,
    status: fix?.success ? 'auto_fixed' : (diagnosis.recommendedAction === 'human_review' ? 'flagged_for_review' : 'open'),
  });

  return { detection, diagnosis, fix };
}