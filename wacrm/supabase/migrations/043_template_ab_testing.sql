-- ============================================================
-- 043_template_ab_testing.sql — Template A/B testing
--
-- Allows A/B testing of message templates with traffic splitting.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS template_ab_tests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name             text NOT NULL,
  template_a_id    uuid NOT NULL REFERENCES message_templates(id) ON DELETE CASCADE,
  template_b_id    uuid NOT NULL REFERENCES message_templates(id) ON DELETE CASCADE,
  split_percentage int NOT NULL DEFAULT 50 CHECK (split_percentage BETWEEN 1 AND 99),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed')),
  winner           text CHECK (winner IN ('A', 'B', 'inconclusive')),
  started_at       timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS template_ab_tests_account_id_idx
  ON template_ab_tests (account_id);

CREATE INDEX IF NOT EXISTS template_ab_tests_status_idx
  ON template_ab_tests (status);

ALTER TABLE template_ab_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_ab_tests_select ON template_ab_tests;
CREATE POLICY template_ab_tests_select ON template_ab_tests FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS template_ab_tests_insert ON template_ab_tests;
CREATE POLICY template_ab_tests_insert ON template_ab_tests FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS template_ab_tests_update ON template_ab_tests;
CREATE POLICY template_ab_tests_update ON template_ab_tests FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS template_ab_tests_delete ON template_ab_tests;
CREATE POLICY template_ab_tests_delete ON template_ab_tests FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Test results tracking
CREATE TABLE IF NOT EXISTS template_ab_test_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ab_test_id       uuid NOT NULL REFERENCES template_ab_tests(id) ON DELETE CASCADE,
  variant          text NOT NULL CHECK (variant IN ('A', 'B')),
  sent_count       int NOT NULL DEFAULT 0,
  delivered_count  int NOT NULL DEFAULT 0,
  read_count       int NOT NULL DEFAULT 0,
  replied_count    int NOT NULL DEFAULT 0,
  failed_count     int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ab_test_id, variant)
);

ALTER TABLE template_ab_test_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_ab_test_results_select ON template_ab_test_results;
CREATE POLICY template_ab_test_results_select ON template_ab_test_results FOR SELECT
  USING (is_account_member((SELECT account_id FROM template_ab_tests WHERE id = template_ab_test_results.ab_test_id)));

-- Helper function to record a send for A/B test
CREATE OR REPLACE FUNCTION record_ab_test_send(p_ab_test_id uuid, p_variant text)
RETURNS void AS $$
BEGIN
  INSERT INTO template_ab_test_results (ab_test_id, variant, sent_count)
  VALUES (p_ab_test_id, p_variant, 1)
  ON CONFLICT (ab_test_id, variant) DO UPDATE SET
    sent_count = template_ab_test_results.sent_count + 1,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;