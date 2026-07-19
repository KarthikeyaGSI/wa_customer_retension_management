-- ============================================================
-- 035_contact_rate_limits.sql — Per-contact rate limiting
--
-- Prevents spam loops from automations / auto-reply by
-- limiting the number of messages sent to a contact within
-- a time window. Used by automation engine and AI auto-reply.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_rate_limits (
  contact_id     uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  count          int NOT NULL DEFAULT 1,
  window_start   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, account_id)
);

CREATE INDEX IF NOT EXISTS contact_rate_limits_account_id_idx
  ON contact_rate_limits (account_id);

-- RLS: admin+ can view/reset
ALTER TABLE contact_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_rate_limits_select ON contact_rate_limits;
CREATE POLICY contact_rate_limits_select ON contact_rate_limits FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_rate_limits_insert ON contact_rate_limits;
CREATE POLICY contact_rate_limits_insert ON contact_rate_limits FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_rate_limits_update ON contact_rate_limits;
CREATE POLICY contact_rate_limits_update ON contact_rate_limits FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_rate_limits_delete ON contact_rate_limits;
CREATE POLICY contact_rate_limits_delete ON contact_rate_limits FOR DELETE
  USING (is_account_member(account_id, 'admin'));