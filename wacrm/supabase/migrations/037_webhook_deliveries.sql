-- ============================================================
-- 037_webhook_deliveries.sql — Webhook delivery queue
--
-- Persistent queue for outbound webhook deliveries with
-- retry logic and dead-letter tracking.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event            text NOT NULL,                    -- 'message.received', 'message.status_updated', 'conversation.created'
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

CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx
  ON webhook_deliveries (status);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ can see deliveries for their account
DROP POLICY IF EXISTS webhook_deliveries_select ON webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON webhook_deliveries FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- INSERT/UPDATE: only service role (delivery worker)
-- No user-facing INSERT/UPDATE policy

-- ============================================================
-- Automatic cleanup of old deliveries
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_webhook_deliveries()
RETURNS void AS $$
BEGIN
  -- Delete delivered/failed deliveries older than 30 days
  DELETE FROM webhook_deliveries
  WHERE status IN ('delivered', 'failed')
    AND created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule via pg_cron if available:
-- SELECT cron.schedule('webhook-delivery-cleanup', '0 3 * * *', 'SELECT cleanup_webhook_deliveries();');