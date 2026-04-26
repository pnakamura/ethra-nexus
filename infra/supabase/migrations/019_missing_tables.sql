-- Migration 019: create missing tables and fix schema gaps
-- Safe: IF NOT EXISTS + ADD COLUMN IF NOT EXISTS throughout

-- tenants: add settings column (Drizzle schema uses settings, SQL used config)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';

-- agents: give wiki_scope a default so INSERT without it doesn't fail NOT NULL.
-- Conditional: the column was removed from the Drizzle schema, so DBs bootstrapped
-- from infra/vps/schema-drizzle.sql don't have it — skip the ALTER in that case.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='wiki_scope'
  ) THEN
    ALTER TABLE agents ALTER COLUMN wiki_scope SET DEFAULT '';
  END IF;
END $$;

-- agent_skills: discrete skill assignments per agent
CREATE TABLE IF NOT EXISTS agent_skills (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  skill_name   TEXT        NOT NULL,
  skill_config JSONB       NOT NULL DEFAULT '{}',
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_skills_unique_idx
  ON agent_skills(agent_id, skill_name);

CREATE INDEX IF NOT EXISTS agent_skills_agent_id_idx  ON agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS agent_skills_tenant_id_idx ON agent_skills(tenant_id);

ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;

-- budgets: monthly spend tracking per agent (replaces agent_budget_periods for Drizzle)
CREATE TABLE IF NOT EXISTS budgets (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID           NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tenant_id    UUID           NOT NULL REFERENCES tenants(id),
  month        TEXT           NOT NULL,  -- 'YYYY-MM'
  limit_usd    NUMERIC(10,2)  NOT NULL DEFAULT 50.00,
  spent_usd    NUMERIC(10,4)  NOT NULL DEFAULT 0,
  tokens_used  INTEGER        NOT NULL DEFAULT 0,
  throttled_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS budgets_agent_month_idx
  ON budgets(agent_id, month);

CREATE INDEX IF NOT EXISTS budgets_tenant_id_idx ON budgets(tenant_id);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
