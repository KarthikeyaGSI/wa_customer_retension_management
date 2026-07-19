-- ============================================================
-- 034_incident_webhooks.sql — Incident notification webhooks
--
-- Allows accounts to register webhook endpoints that receive
-- incident notifications (when support agent flags issues).
-- Separate from the regular event webhooks so operators can
-- route alerts to Slack, PagerDuty, Discord, etc.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS incident_webhooks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  url              text NOT NULL,
  secret           text NOT NULL,             -- AES-256-GCM encrypted
  event_types      text[] NOT NULL DEFAULT '{}', -- which incidents to receive
  is_active        boolean NOT NULL DEFAULT true,
  last_sent_at     timestamptz,
  failure_count    int NOT NULL DEFAULT 0,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incident_webhooks_account_id_idx
  ON incident_webhooks (account_id);

ALTER TABLE incident_webhooks ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ can view
DROP POLICY IF EXISTS incident_webhooks_select ON incident_webhooks;
CREATE POLICY incident_webhooks_select ON incident_webhooks FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- INSERT/UPDATE/DELETE: admin+ only
DROP POLICY IF EXISTS incident_webhooks_insert ON incident_webhooks;
CREATE POLICY incident_webhooks_insert ON incident_webhooks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS incident_webhooks_update ON incident_webhooks;
CREATE POLICY incident_webhooks_update ON incident_webhooks FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS incident_webhooks_delete ON incident_webhooks;
CREATE POLICY incident_webhooks_delete ON incident_webhooks FOR DELETE
  USING (is_account_member(account_id, 'admin'));