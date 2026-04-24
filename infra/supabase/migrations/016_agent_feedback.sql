-- Migration 016: agent_feedback — Feedback Loop (Fase 22B)
-- Safe: new table only, no existing tables modified

CREATE TABLE IF NOT EXISTS agent_feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  aios_event_id UUID NOT NULL REFERENCES aios_events(id) ON DELETE CASCADE,
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT agent_feedback_event_unique UNIQUE (aios_event_id)
);

CREATE INDEX IF NOT EXISTS agent_feedback_agent_idx   ON agent_feedback(agent_id, created_at);
CREATE INDEX IF NOT EXISTS agent_feedback_tenant_idx  ON agent_feedback(tenant_id);

ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON agent_feedback
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON agent_feedback
  FOR SELECT USING (tenant_id = ANY(user_tenant_ids()));

CREATE POLICY "tenant_admins_write" ON agent_feedback
  FOR ALL USING (user_is_tenant_admin(tenant_id));
