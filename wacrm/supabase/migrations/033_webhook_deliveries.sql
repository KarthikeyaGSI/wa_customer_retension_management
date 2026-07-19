-- ============================================================
-- 033_webhook_deliveries.sql — Durable webhook delivery queue
--
-- Provides a persistent queue for outbound webhook deliveries
-- with exponential backoff retry logic. Replaces the single-
-- attempt fire-and-forget model with a durable, observable
-- queue that survives restarts and can be monitored.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event            text NOT NULL,                    -- 'message.received' etc.
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt          int NOT NULL DEFAULT 0,           -- 0 = initial, increments on retry
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'retrying', 'delivered', 'failed'
  )),
  next_retry_at    timestamptz,                      -- NULL = no more retries
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_id_idx
  ON webhook_deliveries (endpoint_id);

CREATE INDEX IF NOT EXISTS webhook_deliveries_account_id_idx
  ON webhook_deliveries (account_id);

CREATE INDEX IF NOT EXISTS webhook_deliveries_pending_idx
  ON webhook_deliveries (next_retry_at) WHERE status IN ('pending', 'retrying');

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ can see all deliveries for their endpoints
DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON webhook_deliveries FOR SELECT
  USING (
    is_account_member(account_id, 'admin')
  );

-- INSERT: only the delivery worker (service role) creates rows
-- No user-facing INSERT policy

-- UPDATE: only the delivery worker (service role) updates rows
-- No user-facing UPDATE policy

-- ============================================================
-- Automatic cleanup of old deliveries
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_webhook_deliveries()
RETURNS void AS $$
BEGIN
  -- Delete deliveries older than 30 days that are in terminal state
  DELETE FROM webhook_deliveries
  WHERE status IN ('delivered', 'failed')
    AND created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule cleanup via pg_cron if available, otherwise call manually
-- SELECT cron.schedule('webhook-delivery-cleanup', '0 3 * * *', 'SELECT cleanup_webhook_deliveries();');