-- ============================================================
-- 009_fix_aios_events.sql
-- Cria aios_events com schema final correto (idempotente)
--
-- Incorpora as migrations 004 + 006 + correção do triggered_by:
--   - 004: criação inicial da tabela
--   - 006: renomeia module_id→skill_id, task_type→activation_mode,
--           adiciona tokens_used, cost_usd, activation_source
--   - 009: triggered_by como text (sem FK para auth.users — sistema
--           usa JWT, não Supabase Auth)
--
-- Safe: usa CREATE TABLE IF NOT EXISTS + ALTER COLUMN IF EXISTS
-- ============================================================

-- Caso a tabela não exista ainda (primeira aplicação):
CREATE TABLE IF NOT EXISTS aios_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         uuid REFERENCES agents(id) ON DELETE SET NULL,
  skill_id         text NOT NULL,
  activation_mode  text NOT NULL DEFAULT 'on_demand',
  activation_source text,
  payload          jsonb NOT NULL DEFAULT '{}',
  result           jsonb,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'ok', 'error')),
  retryable        boolean NOT NULL DEFAULT false,
  error_code       text,
  tokens_used      integer NOT NULL DEFAULT 0,
  cost_usd         numeric(10,6) NOT NULL DEFAULT 0,
  triggered_by     text,
  user_ip          text,
  user_agent       text,
  triggered_at     timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

-- Caso a tabela já exista com schema antigo (004+006 aplicados):
-- Adiciona colunas novas se ainda não existirem
ALTER TABLE aios_events ADD COLUMN IF NOT EXISTS activation_source text;
ALTER TABLE aios_events ADD COLUMN IF NOT EXISTS tokens_used integer NOT NULL DEFAULT 0;
ALTER TABLE aios_events ADD COLUMN IF NOT EXISTS cost_usd numeric(10,6) NOT NULL DEFAULT 0;

-- Remove FK para auth.users se ainda existir (004 original tinha esse FK)
ALTER TABLE aios_events DROP CONSTRAINT IF EXISTS aios_events_triggered_by_fkey;

-- Garante triggered_by como text
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aios_events'
      AND column_name = 'triggered_by'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE aios_events ALTER COLUMN triggered_by TYPE text USING triggered_by::text;
  END IF;
END $$;

ALTER TABLE aios_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS aios_events_tenant_status_idx
  ON aios_events(tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS aios_events_agent_idx
  ON aios_events(agent_id, started_at DESC);
