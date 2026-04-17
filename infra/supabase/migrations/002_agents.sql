-- ============================================================
-- 002_agents.sql
-- Agentes configuráveis por tenant — 5 dimensões:
-- identity, skills, activation, channels, budget
--
-- O AIOS Master verifica budget ANTES de cada execução.
-- Budget periods são resetados mensalmente via cron.
-- ============================================================

CREATE TABLE agents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL
                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  status          text NOT NULL DEFAULT 'setup'
                  CHECK (status IN ('setup', 'active', 'paused', 'budget_exceeded', 'error', 'archived')),
  description     text,
  avatar_url      text,
  tags            text[] NOT NULL DEFAULT '{}',
  wiki_scope      text NOT NULL,           -- 'agent-{slug}'

  -- Configuração completa em JSONB (tipada no TypeScript como AgentConfig)
  config          jsonb NOT NULL DEFAULT '{
    "identity": {
      "system_prompt": "",
      "response_language": "pt-BR",
      "tone": "professional",
      "restrictions": []
    },
    "skills": [],
    "activation": [{"mode": "on_demand"}],
    "channels": [],
    "budget": {
      "monthly_limit_usd": 50,
      "monthly_token_limit": 0,
      "max_tokens_per_call": 4096,
      "max_input_tokens": 8192,
      "alert_thresholds": [
        {"percent": 50, "action": "notify_dashboard"},
        {"percent": 75, "action": "notify_dashboard"},
        {"percent": 90, "action": "notify_email"},
        {"percent": 100, "action": "notify_all"}
      ],
      "on_limit_reached": "pause_agent",
      "current_period_start": "",
      "current_spend_usd": 0,
      "current_token_usage": 0
    },
    "wiki_inherit_system": true
  }',

  last_active_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON agents
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON agents
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE POLICY "tenant_admins_write" ON agents
  FOR ALL USING (user_is_tenant_admin(tenant_id));

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Índices para queries frequentes
CREATE INDEX agents_tenant_status_idx ON agents(tenant_id, status);
CREATE INDEX agents_tags_idx ON agents USING gin(tags);

-- ============================================================
-- agent_budget_periods — histórico mensal de gastos por agente
-- Permite tracking ao longo do tempo e relatórios
-- ============================================================

CREATE TABLE agent_budget_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  period_start    date NOT NULL,           -- primeiro dia do mês
  period_end      date NOT NULL,           -- último dia do mês
  total_spend_usd numeric(10,4) NOT NULL DEFAULT 0,
  total_tokens    bigint NOT NULL DEFAULT 0,
  total_calls     integer NOT NULL DEFAULT 0,
  budget_limit_usd numeric(10,4) NOT NULL, -- snapshot do limite no início do período
  alerts_triggered jsonb NOT NULL DEFAULT '[]', -- thresholds que dispararam
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, period_start)
);

ALTER TABLE agent_budget_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON agent_budget_periods
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_admins_read" ON agent_budget_periods
  FOR SELECT USING (user_is_tenant_admin(tenant_id));

CREATE TRIGGER agent_budget_periods_updated_at
  BEFORE UPDATE ON agent_budget_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- View: estado atual de budget de todos os agentes do tenant
-- ============================================================

CREATE VIEW agent_budget_status AS
SELECT
  a.id AS agent_id,
  a.tenant_id,
  a.name,
  a.slug,
  a.status,
  (a.config->'budget'->>'monthly_limit_usd')::numeric AS monthly_limit_usd,
  (a.config->'budget'->>'current_spend_usd')::numeric AS current_spend_usd,
  (a.config->'budget'->>'current_token_usage')::bigint AS current_token_usage,
  (a.config->'budget'->>'monthly_token_limit')::bigint AS monthly_token_limit,
  CASE
    WHEN (a.config->'budget'->>'monthly_limit_usd')::numeric > 0
    THEN ROUND(
      ((a.config->'budget'->>'current_spend_usd')::numeric /
       (a.config->'budget'->>'monthly_limit_usd')::numeric) * 100, 1
    )
    ELSE 0
  END AS budget_percent_used,
  a.config->'budget'->>'on_limit_reached' AS on_limit_action,
  a.last_active_at,
  -- Skills habilitadas
  (
    SELECT array_agg(skill->>'skill_id')
    FROM jsonb_array_elements(a.config->'skills') AS skill
    WHERE (skill->>'enabled')::boolean = true
  ) AS active_skills,
  -- Modos de ativação
  (
    SELECT array_agg(DISTINCT act->>'mode')
    FROM jsonb_array_elements(a.config->'activation') AS act
  ) AS activation_modes
FROM agents a
WHERE a.status != 'archived';

-- ============================================================
-- Function: calcular gasto atual do agente no período
-- Chamada pelo AIOS Master antes de cada execução
-- ============================================================

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

-- ============================================================
-- Function: resetar budget mensal de todos os agentes
-- Executar via cron no primeiro dia de cada mês
-- ============================================================

CREATE OR REPLACE FUNCTION reset_monthly_budgets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  reset_count integer := 0;
  agent_record RECORD;
  period_s date := date_trunc('month', now())::date;
  period_e date := (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date;
BEGIN
  FOR agent_record IN
    SELECT id, tenant_id, config
    FROM agents
    WHERE status != 'archived'
  LOOP
    -- Salvar período anterior no histórico
    INSERT INTO agent_budget_periods (
      tenant_id, agent_id, period_start, period_end,
      total_spend_usd, total_tokens, total_calls,
      budget_limit_usd, alerts_triggered
    ) VALUES (
      agent_record.tenant_id,
      agent_record.id,
      (date_trunc('month', now() - interval '1 month'))::date,
      (date_trunc('month', now()) - interval '1 day')::date,
      (agent_record.config->'budget'->>'current_spend_usd')::numeric,
      (agent_record.config->'budget'->>'current_token_usage')::bigint,
      0, -- total_calls preenchido na migration futura
      (agent_record.config->'budget'->>'monthly_limit_usd')::numeric,
      agent_record.config->'budget'->'alert_thresholds'
    )
    ON CONFLICT (agent_id, period_start) DO NOTHING;

    -- Resetar contadores do período atual
    UPDATE agents
    SET config = jsonb_set(
      jsonb_set(
        jsonb_set(
          config,
          '{budget,current_spend_usd}', '0'::jsonb
        ),
        '{budget,current_token_usage}', '0'::jsonb
      ),
      '{budget,current_period_start}',
      to_jsonb(period_s::text)
    )
    WHERE id = agent_record.id;

    -- Se estava pausado por budget, reativar
    UPDATE agents
    SET status = 'active'
    WHERE id = agent_record.id AND status = 'budget_exceeded';

    reset_count := reset_count + 1;
  END LOOP;

  RETURN reset_count;
END;
$$;

-- ============================================================
-- agent_conversations — histórico de conversas por agente
-- ============================================================

CREATE TABLE agent_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel     text NOT NULL,
  external_id text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  started_at  timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON agent_conversations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON agent_conversations
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

-- ============================================================
-- agent_messages — mensagens individuais
-- ============================================================

CREATE TABLE agent_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          text NOT NULL,
  skill_id         text,                  -- qual skill gerou esta mensagem
  wiki_pages_used  text[] DEFAULT '{}',
  tokens_used      integer DEFAULT 0,
  cost_usd         numeric(10,6) DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON agent_messages
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON agent_messages
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE INDEX agent_messages_conversation_idx
  ON agent_messages(conversation_id, created_at);
CREATE INDEX agent_messages_agent_cost_idx
  ON agent_messages(agent_id, created_at)
  WHERE cost_usd > 0;
