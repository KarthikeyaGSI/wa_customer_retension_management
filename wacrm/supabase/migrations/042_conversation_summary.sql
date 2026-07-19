-- ============================================================
-- 042_conversation_summary.sql — Conversation AI summary
--
-- Stores AI-generated conversation summaries for quick context.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summary_key_points jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS summary_sentiment text CHECK (summary_sentiment IN ('positive', 'neutral', 'negative')),
  ADD COLUMN IF NOT EXISTS summary_updated_at timestamptz;