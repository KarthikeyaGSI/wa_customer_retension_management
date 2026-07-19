-- ============================================================
-- 037_contact_rate_limit_blocks.sql — Per-contact rate limiting
--
-- Prevents spam loops by blocking contacts that receive too many
-- outbound messages from agents/automations within a time window.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_rate_limit_blocks (
  contact_id       uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  blocked_until    timestamptz NOT NULL,
  reason           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_rate_limit_blocks_blocked_until_idx
  ON contact_rate_limit_blocks (blocked_until)
  WHERE blocked_until > now();

ALTER TABLE contact_rate_limit_blocks ENABLE ROW LEVEL SECURITY;

-- Admin+ can view blocks for their account
DROP POLICY IF EXISTS contact_rate_limit_blocks_select ON contact_rate_limit_blocks;
CREATE POLICY contact_rate_limit_blocks_select ON contact_rate_limit_blocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_rate_limit_blocks.contact_id
        AND is_account_member(c.account_id, 'admin')
    )
  );

-- Admin+ can manually remove blocks
DROP POLICY IF EXISTS contact_rate_limit_blocks_delete ON contact_rate_limit_blocks;
CREATE POLICY contact_rate_limit_blocks_delete ON contact_rate_limit_blocks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_rate_limit_blocks.contact_id
        AND is_account_member(c.account_id, 'admin')
    )
  );

-- Automatic cleanup of expired blocks
CREATE OR REPLACE FUNCTION cleanup_expired_contact_rate_limit_blocks()
RETURNS void AS $$
BEGIN
  DELETE FROM contact_rate_limit_blocks
  WHERE blocked_until < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;