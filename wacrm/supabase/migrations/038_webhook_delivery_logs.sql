-- ============================================================
-- 038_webhook_delivery_logs.sql — Webhook delivery audit log
--
-- Records every delivery attempt (success/failure) for debugging,
-- monitoring, and the support agent's retry queue.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_delivery_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id      uuid NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event            text NOT NULL,
  attempt          int NOT NULL DEFAULT 1,
  status_code      int,
  response_body    text,
  error_message    text,
  duration_ms      int NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_delivery_logs_delivery_id_idx
  ON webhook_delivery_logs (delivery_id);

CREATE INDEX IF NOT EXISTS webhook_delivery_logs_endpoint_id_idx
  ON webhook_delivery_logs (endpoint_id);

CREATE INDEX IF NOT EXISTS webhook_delivery_logs_account_id_idx
  ON webhook_delivery_logs (account_id);

CREATE INDEX IF NOT EXISTS webhook_delivery_logs_created_at_idx
  ON webhook_delivery_logs (created_at DESC);

ALTER TABLE webhook_delivery_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ can see logs for their account
DROP POLICY IF EXISTS webhook_delivery_logs_select ON webhook_delivery_logs;
CREATE POLICY webhook_delivery_logs_select ON webhook_delivery_logs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- INSERT: only service role (delivery worker)
-- No user-facing INSERT policy