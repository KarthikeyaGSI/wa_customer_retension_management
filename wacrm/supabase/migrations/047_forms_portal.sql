-- ============================================================
-- 047_forms_portal.sql — Intake forms & customer portal
--
-- forms:        account-built lead-capture forms (public token)
-- portal_links: shareable read-only portal for a single contact
--
-- Both are account-scoped, token-protected, RLS-guarded. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- Intake forms
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Public, unguessable token used in the URL (/forms/<token>).
  token         text NOT NULL UNIQUE,
  title         text NOT NULL DEFAULT 'Contact us',
  description   text,
  -- Ordered field definitions, e.g.
  -- [{ name, label, type, required, options }]
  fields        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- When a submission creates a deal, use this pipeline/stage.
  pipeline_id   uuid REFERENCES pipelines(id) ON DELETE SET NULL,
  stage_id      uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  -- Fire the 'new_contact_created' automations on submit.
  trigger_automations boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forms_account_id_idx ON forms (account_id);
CREATE INDEX IF NOT EXISTS forms_token_idx     ON forms (token);

ALTER TABLE forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forms_select ON forms;
CREATE POLICY forms_select ON forms FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS forms_insert ON forms;
CREATE POLICY forms_insert ON forms FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS forms_update ON forms;
CREATE POLICY forms_update ON forms FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS forms_delete ON forms;
CREATE POLICY forms_delete ON forms FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- Form submissions (audit + re-create later)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  form_id      uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_submissions_form_id_idx
  ON form_submissions (form_id);
CREATE INDEX IF NOT EXISTS form_submissions_account_id_idx
  ON form_submissions (account_id);

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_submissions_select ON form_submissions;
CREATE POLICY form_submissions_select ON form_submissions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS form_submissions_insert ON form_submissions;
CREATE POLICY form_submissions_insert ON form_submissions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- ------------------------------------------------------------
-- Customer portal links
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Public, unguessable token used in the URL (/portal/<token>).
  token        text NOT NULL UNIQUE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT 'My account',
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_links_account_id_idx ON portal_links (account_id);
CREATE INDEX IF NOT EXISTS portal_links_token_idx     ON portal_links (token);
CREATE INDEX IF NOT EXISTS portal_links_contact_idx   ON portal_links (contact_id);

ALTER TABLE portal_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_links_select ON portal_links;
CREATE POLICY portal_links_select ON portal_links FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS portal_links_insert ON portal_links;
CREATE POLICY portal_links_insert ON portal_links FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS portal_links_update ON portal_links;
CREATE POLICY portal_links_update ON portal_links FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS portal_links_delete ON portal_links;
CREATE POLICY portal_links_delete ON portal_links FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Keep updated_at fresh.
DROP TRIGGER IF EXISTS forms_set_updated_at ON forms;
CREATE TRIGGER forms_set_updated_at
  BEFORE UPDATE ON forms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS portal_links_set_updated_at ON portal_links;
CREATE TRIGGER portal_links_set_updated_at
  BEFORE UPDATE ON portal_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
