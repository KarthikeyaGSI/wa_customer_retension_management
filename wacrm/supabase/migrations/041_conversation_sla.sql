-- ============================================================
-- 041_conversation_sla.sql — Conversation SLA tracking
--
-- Tracks first response time, resolution time, and SLA breaches.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Add SLA columns to conversations
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breached boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS sla_breach_type text CHECK (sla_breach_type IN ('first_response', 'resolution'));

-- SLA policy per account
CREATE TABLE IF NOT EXISTS sla_policies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name             text NOT NULL DEFAULT 'Default',
  first_response_hours int NOT NULL DEFAULT 4,   -- SLA for first response
  resolution_hours   int NOT NULL DEFAULT 24,   -- SLA for resolution
  business_hours_only boolean DEFAULT false,   -- Only count business hours
  timezone         text NOT NULL DEFAULT 'UTC',
  is_default       boolean DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, is_default) WHERE is_default = true
);

CREATE INDEX IF NOT EXISTS sla_policies_account_id_idx
  ON sla_policies (account_id);

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sla_policies_select ON sla_policies;
CREATE POLICY sla_policies_select ON sla_policies FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sla_policies_insert ON sla_policies;
CREATE POLICY sla_policies_insert ON sla_policies FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sla_policies_update ON sla_policies;
CREATE POLICY sla_policies_update ON sla_policies FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sla_policies_delete ON sla_policies;
CREATE POLICY sla_policies_delete ON sla_policies FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- SLA breach log
CREATE TABLE IF NOT EXISTS sla_breaches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  breach_type      text NOT NULL CHECK (breach_type IN ('first_response', 'resolution')),
  expected_at      timestamptz NOT NULL,
  breached_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sla_breaches_account_id_idx
  ON sla_breaches (account_id);

CREATE INDEX IF NOT EXISTS sla_breaches_conversation_id_idx
  ON sla_breaches (conversation_id);

ALTER TABLE sla_breaches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sla_breaches_select ON sla_breaches;
CREATE POLICY sla_breaches_select ON sla_breaches FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- Default SLA policy for new accounts
CREATE OR REPLACE FUNCTION create_default_sla_policy()
RETURNS trigger AS $$
BEGIN
  INSERT INTO sla_policies (account_id, name, is_default)
  VALUES (NEW.id, 'Default SLA', true)
  ON CONFLICT (account_id, is_default) WHERE is_default = true DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS create_sla_policy_for_account ON accounts;
CREATE TRIGGER create_sla_policy_for_account
  AFTER INSERT ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION create_default_sla_policy();