// ============================================================
// Support Agent Cron Endpoint
// ============================================================
//
// Runs the detect/diagnose/fix/flag pipeline on a schedule.
// Protected by SUPPORT_AGENT_CRON_SECRET header (Vercel Cron).
// ============================================================

import { NextResponse } from 'next/server';
import { runSupportAgentCheck } from '@/lib/support-agent';

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.SUPPORT_AGENT_CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: 'Support agent cron not configured (SUPPORT_AGENT_CRON_SECRET missing)' },
      { status: 503 }
    );
  }

  const supplied = request.headers.get('x-cron-secret');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSupportAgentCheck();

    // Return summary; detailed logs are in incident_logs table
    return NextResponse.json({
      scanned_at: new Date().toISOString(),
      detections: result.detections.length,
      auto_fixed: result.fixes.filter((f) => f.fix.success).length,
      fix_failed: result.fixes.filter((f) => !f.fix.success).length,
      flagged_for_review: result.flagged.length,
      errors: result.errors.length,
      details: {
        detections: result.detections.map((d) => ({
          type: d.incidentType,
          account: d.accountId,
          summary: d.summary,
        })),
        auto_fixed: result.fixes
          .filter((f) => f.fix.success)
          .map((f) => ({
            type: f.incidentType,
            account: f.accountId,
            action: f.fix.actionTaken,
          })),
        fix_failed: result.fixes
          .filter((f) => !f.fix.success)
          .map((f) => ({
            type: f.incidentType,
            account: f.accountId,
            error: f.fix.error,
          })),
        flagged: result.flagged.map((f) => ({
          type: f.incidentType,
          account: f.accountId,
          severity: f.diagnosis.severity,
          root_cause: f.diagnosis.rootCause,
        })),
      },
    });
  } catch (err) {
    console.error('[support-agent-cron] Fatal error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}