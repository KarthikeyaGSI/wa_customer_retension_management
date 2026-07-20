-- ============================================================
-- 048_integrations.sql — Third-party integration config
--
-- One row per account holding Slack + email (Resend) settings.
-- Secret-bearing columns (slack_webhook_url, email_api_key) are
-- stored AES-256-GCM encrypted using the same encrypt() helper
-- used for whatsapp_config.access_token / ai_configs.api_key.
-- UNIQUE(account_id) → exactly one config row per account.
-- ============================================================

CREATE TABLE IF NOT EXISTS integrations_config (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Slack incoming-webhook URL (encrypted at rest).
  slack_enabled       boolean NOT NULL DEFAULT false,
  slack_webhook_url   text,

  -- Email via Resend (encrypted API key; from-address stored plain).
  email_enabled       boolean NOT NULL DEFAULT false,
  email_provider      text NOT NULL DEFAULT 'resend'
                        CHECK (email_provider IN ('resend')),
  email_api_key       text,
  email_from          text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integrations_config_account_id_idx
  ON integrations_config (account_id);

ALTER TABLE integrations_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integrations_config_select ON integrations_config;
CREATE POLICY integrations_config_select ON integrations_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS integrations_config_insert ON integrations_config;
CREATE POLICY integrations_config_insert ON integrations_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integrations_config_update ON integrations_config;
CREATE POLICY integrations_config_update ON integrations_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integrations_config_delete ON integrations_config;
CREATE POLICY integrations_config_delete ON integrations_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS integrations_config_set_updated_at ON integrations_config;
CREATE TRIGGER integrations_config_set_updated_at
  BEFORE UPDATE ON integrations_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
