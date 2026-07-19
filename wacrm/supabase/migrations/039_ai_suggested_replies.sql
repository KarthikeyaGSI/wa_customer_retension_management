-- ============================================================
-- 039_ai_suggested_replies.sql — AI suggested replies cache
--
-- Stores AI-generated reply suggestions for inbox messages.
-- Agents can accept, edit, or dismiss suggestions.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_suggested_replies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id       uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  suggestion_text  text NOT NULL,
  model            text NOT NULL,
  tokens_used      int,
  confidence       real,               -- 0.0-1.0
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'accepted', 'edited', 'dismissed'
  )),
  accepted_text    text,               -- what was actually sent (if edited)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_suggested_replies_conversation_id_idx
  ON ai_suggested_replies (conversation_id);

CREATE INDEX IF NOT EXISTS ai_suggested_replies_message_id_idx
  ON ai_suggested_replies (message_id);

CREATE INDEX IF NOT EXISTS ai_suggested_replies_status_idx
  ON ai_suggested_replies (status);

ALTER TABLE ai_suggested_replies ENABLE ROW LEVEL SECURITY;

-- SELECT: any account member can view suggestions for their conversations
DROP POLICY IF EXISTS ai_suggested_replies_select ON ai_suggested_replies;
CREATE POLICY ai_suggested_replies_select ON ai_suggested_replies FOR SELECT
  USING (is_account_member(account_id));

-- UPDATE: agent can update status (accept/edit/dismiss)
DROP POLICY IF EXISTS ai_suggested_replies_update ON ai_suggested_replies;
CREATE POLICY ai_suggested_replies_update ON ai_suggested_replies FOR UPDATE
  USING (is_account_member(account_id))
  WITH CHECK (is_account_member(account_id));

-- INSERT: only service role (AI worker)
-- No user-facing INSERT policy