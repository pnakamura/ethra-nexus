-- ============================================================
-- 006_align_aios_events.sql
-- Alinha o schema de aios_events com a interface TypeScript
-- que passou a usar skill_id, activation_mode, tokens_used, cost_usd
-- ============================================================

-- Renomear colunas para alinhar com TypeScript
ALTER TABLE aios_events RENAME COLUMN module_id TO skill_id;
ALTER TABLE aios_events RENAME COLUMN task_type TO activation_mode;

-- Adicionar coluna activation_source
ALTER TABLE aios_events
  ADD COLUMN IF NOT EXISTS activation_source text;

-- Garantir que tokens_used e cost_usd existem
-- (migration 004 pode não tê-las dependendo da ordem de execução)
ALTER TABLE aios_events
  ADD COLUMN IF NOT EXISTS tokens_used integer NOT NULL DEFAULT 0;

ALTER TABLE aios_events
  ADD COLUMN IF NOT EXISTS cost_usd numeric(10,6) NOT NULL DEFAULT 0;

-- Recalcular a generated column duration_ms (se existir, recriar)
-- A 004 já pode ter criado como GENERATED, então só garantimos o index
CREATE INDEX IF NOT EXISTS aios_events_cost_idx
  ON aios_events(agent_id, cost_usd)
  WHERE cost_usd > 0;

-- Atualizar a view de sumário
DROP VIEW IF EXISTS aios_events_summary;
CREATE VIEW aios_events_summary AS
SELECT
  tenant_id,
  skill_id,
  activation_mode,
  status,
  COUNT(*) AS total,
  SUM(tokens_used) AS total_tokens,
  SUM(cost_usd)::numeric(10,4) AS total_cost_usd,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::int AS avg_duration_ms,
  MAX(started_at) AS last_executed_at
FROM aios_events
WHERE started_at > now() - interval '7 days'
GROUP BY tenant_id, skill_id, activation_mode, status
ORDER BY tenant_id, last_executed_at DESC;

-- Atualizar a função get_agent_spend_current_period para usar cost_usd
DROP FUNCTION IF EXISTS get_agent_spend_current_period(uuid, timestamptz);
CREATE OR REPLACE FUNCTION get_agent_spend_current_period(
  p_agent_id uuid,
  p_period_start timestamptz
)
RETURNS TABLE (total_usd numeric, total_tokens bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(cost_usd), 0)::numeric AS total_usd,
    COALESCE(SUM(tokens_used), 0)::bigint AS total_tokens
  FROM aios_events
  WHERE agent_id = p_agent_id
    AND status = 'ok'
    AND started_at >= p_period_start;
$$;
