-- Migration 014: protocolo A2A — API keys, agentes externos, flag público
-- Safe: ADD COLUMN IF NOT EXISTS (idempotente) + CREATE TABLE IF NOT EXISTS

-- Flag de agente público A2A
ALTER TABLE agents ADD COLUMN IF NOT EXISTS a2a_enabled BOOLEAN NOT NULL DEFAULT false;

-- Contexto externo em eventos A2A
ALTER TABLE aios_events ADD COLUMN IF NOT EXISTS a2a_context_id TEXT;

-- API keys para autenticação de chamadas A2A de entrada
CREATE TABLE IF NOT EXISTS a2a_api_keys (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id),
  agent_id   UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  key_hash   TEXT        NOT NULL,
  key_prefix TEXT        NOT NULL,
  expires_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE a2a_api_keys ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS a2a_api_keys_tenant_id_idx ON a2a_api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS a2a_api_keys_key_hash_idx  ON a2a_api_keys(key_hash);

-- RLS policies
CREATE POLICY "service_role_full_access" ON a2a_api_keys
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON a2a_api_keys
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE POLICY "tenant_admins_write" ON a2a_api_keys
  FOR ALL USING (user_is_tenant_admin(tenant_id));

-- Registry de agentes A2A externos
CREATE TABLE IF NOT EXISTS external_agents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id),
  name           TEXT        NOT NULL,
  url            TEXT        NOT NULL,
  agent_card     JSONB       NOT NULL,
  auth_token     TEXT,               -- stored plaintext; encrypt at rest in future migration
  status         TEXT        NOT NULL DEFAULT 'active',
  last_checked_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, url)
);

ALTER TABLE external_agents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS external_agents_tenant_id_idx ON external_agents(tenant_id);

-- RLS policies
CREATE POLICY "service_role_full_access" ON external_agents
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON external_agents
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE POLICY "tenant_admins_write" ON external_agents
  FOR ALL USING (user_is_tenant_admin(tenant_id));

-- Updated_at trigger
CREATE TRIGGER external_agents_updated_at
  BEFORE UPDATE ON external_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
