-- ============================================================
-- 040_scheduled_messages.sql — Message scheduling
--
-- Allows scheduling messages for future delivery.
-- A cron job processes pending messages at their scheduled time.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_type     text NOT NULL,
  content_text     text,
  media_url        text,
  template_name    text,
  template_language text,
  template_params  jsonb,
  send_at          timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error_message    text,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_messages_account_id_idx
  ON scheduled_messages (account_id);

CREATE INDEX IF NOT EXISTS scheduled_messages_pending_idx
  ON scheduled_messages (send_at) WHERE status = 'pending';

ALTER TABLE scheduled_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ can view
DROP POLICY IF EXISTS scheduled_messages_select ON scheduled_messages;
CREATE POLICY scheduled_messages_select ON scheduled_messages FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- INSERT/UPDATE: admin+ can manage
DROP POLICY IF EXISTS scheduled_messages_insert ON scheduled_messages;
CREATE POLICY scheduled_messages_insert ON scheduled_messages FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS scheduled_messages_update ON scheduled_messages;
CREATE POLICY scheduled_messages_update ON scheduled_messages FOR UPDATE
  USING (is_account_member(account_id, 'admin'));