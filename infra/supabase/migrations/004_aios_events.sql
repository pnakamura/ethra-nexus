-- ============================================================
-- 004_aios_events.sql
-- Log de execução do AIOS Master Orchestrator
-- Cada task executada gera um evento auditável
--
-- SEGURANÇA:
-- - Campos de audit trail: triggered_by, user_ip, user_agent
-- - LGPD: art. 37 — registros de atividades de tratamento
-- - Imutável após criação: apenas status/result/completed_at atualizáveis
-- - Partition pronta para pruning de dados antigos
-- ============================================================

CREATE TABLE aios_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         uuid REFERENCES agents(id) ON DELETE SET NULL,
  module_id        text NOT NULL,
  task_type        text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}',
  result           jsonb,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'ok', 'error')),
  retryable        boolean NOT NULL DEFAULT false,
  error_code       text,

  -- Audit trail — LGPD compliance
  triggered_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_ip          inet,                  -- IPv4 ou IPv6 do originador
  user_agent       text,                  -- browser/app user-agent
  triggered_at     timestamptz NOT NULL DEFAULT now(),  -- quando o request chegou

  -- Execution timing
  started_at       timestamptz NOT NULL DEFAULT now(),  -- quando a execução começou
  completed_at     timestamptz,
  duration_ms      integer GENERATED ALWAYS AS (
    CASE WHEN completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (completed_at - started_at))::int * 1000
      ELSE NULL
    END
  ) STORED
);

ALTER TABLE aios_events ENABLE ROW LEVEL SECURITY;

-- Service role: acesso total (backend, N8N)
CREATE POLICY "service_role_full_access" ON aios_events
  FOR ALL USING (auth.role() = 'service_role');

-- Admins: leitura do próprio tenant (via helper function)
CREATE POLICY "tenant_admins_read" ON aios_events
  FOR SELECT USING (user_is_tenant_admin(tenant_id));

-- Membros: leitura básica dos eventos dos seus agentes
CREATE POLICY "members_read_own_events" ON aios_events
  FOR SELECT USING (
    tenant_id = ANY(user_tenant_ids())
    AND triggered_by = auth.uid()
  );

-- Índices otimizados
CREATE INDEX aios_events_tenant_status_idx
  ON aios_events(tenant_id, status, started_at DESC);
CREATE INDEX aios_events_agent_idx
  ON aios_events(agent_id, started_at DESC);
CREATE INDEX aios_events_audit_idx
  ON aios_events(tenant_id, triggered_by, triggered_at DESC);

-- View de sumário para dashboard
CREATE VIEW aios_events_summary AS
SELECT
  tenant_id,
  module_id,
  task_type,
  status,
  COUNT(*) AS total,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::int AS avg_duration_ms,
  MAX(started_at) AS last_executed_at
FROM aios_events
WHERE started_at > now() - interval '7 days'
GROUP BY tenant_id, module_id, task_type, status
ORDER BY tenant_id, last_executed_at DESC;

-- ============================================================
-- Retention policy — prunig automático de eventos antigos
-- Manter 90 dias por padrão (LGPD art. 16 — eliminação)
-- ============================================================
CREATE OR REPLACE FUNCTION prune_old_aios_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM aios_events
  WHERE started_at < now() - interval '90 days'
    AND status IN ('ok', 'error');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
