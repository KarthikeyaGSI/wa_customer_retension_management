-- ============================================================
-- 045_task_reminder_notifications.sql
--
-- Extends the notifications `type` enum to carry task reminders
-- fired by the /api/tasks/reminders/cron worker. The new type is
-- inserted by the cron using the service-role client (bypasses
-- the client-only INSERT restriction), and surfaced to the
-- assignee via the existing notifications RLS policy. Idempotent.
-- ============================================================

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'task_reminder'));

-- Index to help the cron find pending reminders efficiently.
CREATE INDEX IF NOT EXISTS tasks_remind_pending_idx
  ON tasks (remind_at)
  WHERE status <> 'done' AND remind_at IS NOT NULL;
