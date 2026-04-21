-- infra/supabase/migrations/012_agent_identity_channels.sql
-- Migration 012: campos de identidade + tabela agent_channels
-- Safe: ADD COLUMN IF NOT EXISTS (idempotente) + CREATE TABLE IF NOT EXISTS

-- Campos de identidade em agents
-- description/avatar_url/tags podem já existir da migration 002 — IF NOT EXISTS é idempotente
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS description         TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url          TEXT,
  ADD COLUMN IF NOT EXISTS tags                TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS system_prompt_extra TEXT,
  ADD COLUMN IF NOT EXISTS response_language   TEXT NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN IF NOT EXISTS tone                TEXT NOT NULL DEFAULT 'professional'
    CHECK (tone IN ('formal','professional','friendly','technical','custom')),
  ADD COLUMN IF NOT EXISTS restrictions        TEXT[] NOT NULL DEFAULT '{}';

-- Tabela de canais por agente
CREATE TABLE IF NOT EXISTS agent_channels (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  agent_id     UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_type TEXT        NOT NULL
    CHECK (channel_type IN ('whatsapp','webchat','email','webhook','slack','api')),
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  config       JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, channel_type)
);

ALTER TABLE agent_channels ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS agent_channels_agent_id_idx  ON agent_channels(agent_id);
CREATE INDEX IF NOT EXISTS agent_channels_tenant_id_idx ON agent_channels(tenant_id);

-- RLS policies
CREATE POLICY "service_role_full_access" ON agent_channels
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON agent_channels
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE POLICY "tenant_admins_write" ON agent_channels
  FOR ALL USING (user_is_tenant_admin(tenant_id));

-- Updated_at trigger
CREATE TRIGGER agent_channels_updated_at
  BEFORE UPDATE ON agent_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
