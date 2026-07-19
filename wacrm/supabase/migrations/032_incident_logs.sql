-- ============================================================
-- 032_incident_logs.sql — Support agent incident log
--
-- Audit trail for the autonomous support agent ("WA net support").
-- Every detection, diagnosis, auto-fix attempt, and human-flag event
-- is recorded here so operators have a full timeline.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS incident_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- What the agent saw
  incident_type    text NOT NULL,
  -- Free-text summary for human scanning
  summary          text NOT NULL,
  -- Structured context for debugging / dashboards
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- One of: detected | diagnosed | auto_fixed | flagged_for_review | manual_review_resolved
  status           text NOT NULL CHECK (status IN (
    'detected',
    'diagnosed',
    'auto_fixed',
    'flagged_for_review',
    'manual_review_resolved'
  )),
  -- Human-readable root cause (filled after diagnose)
  root_cause       text,
  -- What the agent did (or declined to do)
  action_taken     text,
  -- If auto_fixed, what was the specific reversible operation
  fix_action       text,
  -- Timestamp of the event
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- When status moved to auto_fixed / flagged_for_review / manual_review_resolved
  resolved_at      timestamptz
);

CREATE INDEX IF NOT EXISTS incident_logs_account_id_idx
  ON incident_logs (account_id);

CREATE INDEX IF NOT EXISTS incident_logs_incident_type_idx
  ON incident_logs (incident_type);

CREATE INDEX IF NOT EXISTS incident_logs_status_idx
  ON incident_logs (status);

CREATE INDEX IF NOT EXISTS incident_logs_created_at_idx
  ON incident_logs (created_at DESC);

ALTER TABLE incident_logs ENABLE ROW LEVEL SECURITY;

-- Any account member can read incidents for their account.
DROP POLICY IF EXISTS incident_logs_select ON incident_logs;
CREATE POLICY incident_logs_select ON incident_logs FOR SELECT
  USING (is_account_member(account_id));

-- Only the support agent (service role) writes. No user-facing INSERT policy.
-- The cron endpoint and any internal helpers use the service-role client.

-- ============================================================
-- Known incident_type values (documented here; enforced in app layer):
--
-- webhook_endpoint_disabled       — endpoint auto-disabled after threshold
-- webhook_delivery_failing        — endpoint failing but not yet disabled
-- message_send_failed             — outbound send returned meta_error
-- meta_api_error                  — generic Meta API error (token, rate limit)
-- whatsapp_not_configured         — account has no valid whatsapp_config
-- cron_not_firing                 — /api/automations/cron not hit in window
-- automation_stuck                — pending execution stuck in running/pending
-- flow_run_stalled                — flow run stuck in active too long
-- ============================================================