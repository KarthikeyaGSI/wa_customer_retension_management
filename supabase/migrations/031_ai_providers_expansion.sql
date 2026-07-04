-- ============================================================
-- 031_ai_providers_expansion.sql
--
-- Expands the AI setup to allow open source models and custom
-- OpenAI-compatible providers (Nvidia NIM, Groq, Together, etc).
-- ============================================================

-- Drop the old strict check constraint
ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

-- Add a new base_url column for custom providers
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS base_url text;

-- Add the expanded constraint
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'nvidia', 'groq', 'together', 'deepseek', 'openai_compatible'));
