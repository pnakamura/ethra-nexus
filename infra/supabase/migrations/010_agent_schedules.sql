-- Migration 010: agent_schedules, agent_event_subscriptions, scheduled_results
-- Safe: CREATE TABLE IF NOT EXISTS — idempotente

CREATE TABLE IF NOT EXISTS agent_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id        TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  input           JSONB NOT NULL DEFAULT '{}',
  output_channel  TEXT NOT NULL DEFAULT 'api',
  enabled         BOOLEAN NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  next_run_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE agent_schedules ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS schedules_next_run_at_idx ON agent_schedules(next_run_at);
CREATE INDEX IF NOT EXISTS schedules_agent_id_idx ON agent_schedules(agent_id);
CREATE INDEX IF NOT EXISTS schedules_tenant_id_idx ON agent_schedules(tenant_id);

CREATE TABLE IF NOT EXISTS agent_event_subscriptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event_type     TEXT NOT NULL,
  event_filter   JSONB NOT NULL DEFAULT '{}',
  skill_id       TEXT NOT NULL,
  input          JSONB NOT NULL DEFAULT '{}',
  output_channel TEXT NOT NULL DEFAULT 'api',
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE agent_event_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS event_subs_agent_id_idx ON agent_event_subscriptions(agent_id);
CREATE INDEX IF NOT EXISTS event_subs_event_type_idx ON agent_event_subscriptions(event_type);
CREATE INDEX IF NOT EXISTS event_subs_tenant_id_idx ON agent_event_subscriptions(tenant_id);

CREATE TABLE IF NOT EXISTS scheduled_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  agent_id     UUID NOT NULL REFERENCES agents(id),
  schedule_id  UUID REFERENCES agent_schedules(id) ON DELETE SET NULL,
  skill_id     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  tokens_used  INTEGER NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(10,6) NOT NULL DEFAULT 0,
  triggered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE scheduled_results ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS scheduled_results_tenant_id_idx ON scheduled_results(tenant_id);
CREATE INDEX IF NOT EXISTS scheduled_results_schedule_id_idx ON scheduled_results(schedule_id);
