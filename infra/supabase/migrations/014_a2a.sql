-- Migration 014: protocolo A2A — API keys, agentes externos, flag público
-- Safe: ADD COLUMN com DEFAULT + novas tabelas

-- Flag de agente público A2A
ALTER TABLE agents ADD COLUMN a2a_enabled BOOLEAN NOT NULL DEFAULT false;

-- Contexto externo em eventos A2A
ALTER TABLE aios_events ADD COLUMN a2a_context_id TEXT;

-- API keys para autenticação de chamadas A2A de entrada
CREATE TABLE a2a_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  agent_id UUID NOT NULL REFERENCES agents(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE a2a_api_keys ENABLE ROW LEVEL SECURITY;
CREATE INDEX a2a_api_keys_tenant_id_idx ON a2a_api_keys(tenant_id);
CREATE INDEX a2a_api_keys_key_hash_idx ON a2a_api_keys(key_hash);

-- Registry de agentes A2A externos
CREATE TABLE external_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  agent_card JSONB NOT NULL,
  auth_token TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, url)
);

ALTER TABLE external_agents ENABLE ROW LEVEL SECURITY;
CREATE INDEX external_agents_tenant_id_idx ON external_agents(tenant_id);
