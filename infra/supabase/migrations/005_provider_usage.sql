-- ============================================================
-- 005_provider_usage.sql
-- Observabilidade de custo por provider e módulo
-- Base para o dashboard de custo no produto
-- ============================================================

CREATE TABLE provider_usage_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id          uuid REFERENCES agents(id) ON DELETE SET NULL,
  module_id         text NOT NULL,
  provider          text NOT NULL CHECK (provider IN ('anthropic', 'openrouter')),
  model             text NOT NULL,
  input_tokens      integer NOT NULL DEFAULT 0,
  output_tokens     integer NOT NULL DEFAULT 0,
  latency_ms        integer NOT NULL DEFAULT 0,
  is_fallback       boolean NOT NULL DEFAULT false,
  is_sensitive_data boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE provider_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON provider_usage_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_admins_read" ON provider_usage_log
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE INDEX provider_usage_tenant_date_idx
  ON provider_usage_log(tenant_id, created_at DESC);

-- ============================================================
-- Views de custo estimado (referência: preços Abril 2026)
-- ============================================================

CREATE VIEW provider_cost_summary AS
SELECT
  tenant_id,
  module_id,
  provider,
  model,
  COUNT(*)                                        AS calls,
  SUM(input_tokens)                               AS total_input_tokens,
  SUM(output_tokens)                              AS total_output_tokens,
  AVG(latency_ms)::int                            AS avg_latency_ms,
  SUM(is_fallback::int)                           AS fallback_count,
  -- Custo estimado em USD (valores aproximados)
  ROUND(
    CASE
      WHEN provider = 'anthropic' AND model LIKE '%sonnet%'
        THEN (SUM(input_tokens) / 1000000.0 * 3.0) + (SUM(output_tokens) / 1000000.0 * 15.0)
      WHEN provider = 'anthropic' AND model LIKE '%haiku%'
        THEN (SUM(input_tokens) / 1000000.0 * 0.25) + (SUM(output_tokens) / 1000000.0 * 1.25)
      WHEN provider = 'openrouter' AND model LIKE '%llama%8b%'
        THEN (SUM(input_tokens) + SUM(output_tokens)) / 1000000.0 * 0.06
      WHEN provider = 'openrouter' AND model LIKE '%gemini%'
        THEN (SUM(input_tokens) / 1000000.0 * 1.25) + (SUM(output_tokens) / 1000000.0 * 5.0)
      ELSE 0
    END::numeric, 4
  ) AS estimated_cost_usd,
  date_trunc('day', created_at) AS day
FROM provider_usage_log
WHERE created_at > now() - interval '30 days'
GROUP BY tenant_id, module_id, provider, model, date_trunc('day', created_at)
ORDER BY tenant_id, day DESC, calls DESC;
