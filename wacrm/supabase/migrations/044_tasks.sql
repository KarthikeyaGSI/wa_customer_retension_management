-- ============================================================
-- 044_tasks.sql — Task tracking
--
-- Account-scoped tasks with assignee, due dates, priority,
-- status, and optional links to contacts/deals. Idempotent —
-- safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  title        text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority     text NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

  -- Assignee (a profile in this account) — nullable for unassigned.
  assignee_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Optional links to other entities in the same account.
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id      uuid REFERENCES deals(id) ON DELETE SET NULL,

  due_at       timestamptz,
  completed_at timestamptz,
  -- When to fire the reminder notification (null = no reminder).
  remind_at    timestamptz,

  created_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_account_id_idx        ON tasks (account_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_id_idx       ON tasks (assignee_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx            ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_due_at_idx            ON tasks (due_at);
CREATE INDEX IF NOT EXISTS tasks_remind_at_idx         ON tasks (remind_at);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_delete ON tasks FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Keep updated_at fresh on row updates.
DROP TRIGGER IF EXISTS tasks_set_updated_at ON tasks;
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
