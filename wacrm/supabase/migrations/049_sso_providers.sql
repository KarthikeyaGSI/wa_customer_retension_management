-- ============================================================
-- 049_sso_providers.sql — Self-serve OIDC/SAML SSO config
--
-- Per-account identity providers. The app acts as the SP and
-- bridges the authenticated identity into a Supabase user via the
-- admin client (the handle_new_user trigger auto-creates the
-- account + profile). IdP secrets (client_secret) are stored
-- AES-256-GCM encrypted with the shared encrypt() helper.
--
-- idp_type currently supports 'oidc' (Authorization Code flow).
-- ============================================================

CREATE TABLE IF NOT EXISTS sso_providers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  name            text NOT NULL,
  idp_type        text NOT NULL DEFAULT 'oidc'
                    CHECK (idp_type IN ('oidc', 'saml')),
  active          boolean NOT NULL DEFAULT true,

  -- OIDC fields.
  issuer          text,
  client_id       text,
  client_secret   text,               -- encrypted at rest
  redirect_uri    text,
  scopes          text NOT NULL DEFAULT 'openid email profile',

  -- SAML fields (reserved; flow not yet implemented).
  entity_id       text,
  metadata_url    text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sso_providers_account_id_idx ON sso_providers (account_id);

ALTER TABLE sso_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sso_providers_select ON sso_providers;
CREATE POLICY sso_providers_select ON sso_providers FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS sso_providers_insert ON sso_providers;
CREATE POLICY sso_providers_insert ON sso_providers FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sso_providers_update ON sso_providers;
CREATE POLICY sso_providers_update ON sso_providers FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS sso_providers_delete ON sso_providers;
CREATE POLICY sso_providers_delete ON sso_providers FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS sso_providers_set_updated_at ON sso_providers;
CREATE TRIGGER sso_providers_set_updated_at
  BEFORE UPDATE ON sso_providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
