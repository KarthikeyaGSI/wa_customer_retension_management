-- ============================================================
-- 036_automation_versions.sql — Automation versioning & rollback
--
-- Allows cloning automations with version history so operators
-- can rollback to a previous working version.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id    uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  version          int NOT NULL,
  name             text NOT NULL,
  description      text,
  trigger_type     text NOT NULL,
  trigger_config   jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps            jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active        boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  change_summary   text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_versions_automation_id_idx
  ON automation_versions (automation_id, version DESC);

ALTER TABLE automation_versions ENABLE ROW LEVEL SECURITY;

-- SELECT: any member can view versions of automations in their account
DROP POLICY IF EXISTS automation_versions_select ON automation_versions;
CREATE POLICY automation_versions_select ON automation_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_versions.automation_id
        AND is_account_member(a.account_id)
    )
  );

-- INSERT: admin+ can create new versions
DROP POLICY IF EXISTS automation_versions_insert ON automation_versions;
CREATE POLICY automation_versions_insert ON automation_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_versions.automation_id
        AND is_account_member(a.account_id, 'admin')
    )
  );

-- UPDATE/DELETE: admin+ only
DROP POLICY IF EXISTS automation_versions_update ON automation_versions;
CREATE POLICY automation_versions_update ON automation_versions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_versions.automation_id
        AND is_account_member(a.account_id, 'admin')
    )
  );

DROP POLICY IF EXISTS automation_versions_delete ON automation_versions;
CREATE POLICY automation_versions_delete ON automation_versions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_versions.automation_id
        AND is_account_member(a.account_id, 'admin')
    )
  );