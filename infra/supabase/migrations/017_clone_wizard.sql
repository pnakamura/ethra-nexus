-- Migration 017: clone_wizard_sessions — Clone Wizard (Fase 22C)
-- Safe: new table only, no existing tables modified

CREATE TABLE IF NOT EXISTS clone_wizard_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES agents(id)  ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'active',
  questions     JSONB NOT NULL DEFAULT '[]',
  answers       JSONB NOT NULL DEFAULT '[]',
  pages_created INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at  TIMESTAMPTZ,
  CONSTRAINT clone_wizard_status_check CHECK (status IN ('active', 'completed', 'abandoned'))
);

CREATE INDEX IF NOT EXISTS cws_agent_idx  ON clone_wizard_sessions(agent_id);
CREATE INDEX IF NOT EXISTS cws_tenant_idx ON clone_wizard_sessions(tenant_id);

ALTER TABLE clone_wizard_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON clone_wizard_sessions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON clone_wizard_sessions
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE POLICY "tenant_admins_write" ON clone_wizard_sessions
  FOR ALL USING (user_is_tenant_admin(tenant_id));
