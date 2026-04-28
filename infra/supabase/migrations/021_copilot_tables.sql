-- ============================================================
-- 021_copilot_tables.sql
-- AIOS Master Agent (shell) — Spec #1
-- Tabelas de conversas, mensagens (Anthropic content blocks),
-- e audit de tool calls do copilot conversacional read-only.
--
-- SEGURANÇA:
-- - RLS habilitado + policies (service_role + tenant scoping)
-- - tenant_id NOT NULL e indexado em todas
-- - cascade delete: conv → messages → tool_calls
-- - CHECK constraints em status
-- - updated_at trigger em conversations (segue padrão da casa)
--
-- AUTH MODEL:
-- - JWT da casa contém { tenantId, email, role } — não tem 'sub'
-- - user_id em copilot_conversations armazena o EMAIL do JWT
-- - RLS member-read usa auth.jwt()->>'email'
-- - Permission per-user (copilot_enabled) DEFERIDO até JWT ter user identity real;
--   MVP é admin-only via JWT.role no app layer.
-- ============================================================

-- ── 1. Conversations ────────────────────────────────────────

CREATE TABLE copilot_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,                                -- JWT email
  agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
  title           TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
  message_count   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE copilot_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON copilot_conversations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "members_read_own_conversations" ON copilot_conversations
  FOR SELECT USING (
    tenant_id = ANY(user_tenant_ids())
    AND user_id = (auth.jwt()->>'email')
  );

CREATE INDEX cc_tenant_user_recent_idx ON copilot_conversations(tenant_id, user_id, last_message_at DESC);
CREATE INDEX cc_tenant_status_idx      ON copilot_conversations(tenant_id, status);

CREATE TRIGGER copilot_conversations_updated_at
  BEFORE UPDATE ON copilot_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. Messages (Anthropic content blocks: text/tool_use/tool_result) ─

CREATE TABLE copilot_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role            TEXT NOT NULL
                    CHECK (role IN ('user', 'assistant')),
  content         JSONB NOT NULL,
  model           TEXT,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  stop_reason     TEXT,
  error_code      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE copilot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON copilot_messages
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "members_read_own_messages" ON copilot_messages
  FOR SELECT USING (
    tenant_id = ANY(user_tenant_ids())
    AND conversation_id IN (
      SELECT id FROM copilot_conversations
      WHERE user_id = (auth.jwt()->>'email')
    )
  );

CREATE INDEX cm_conv_time_idx ON copilot_messages(conversation_id, created_at);

-- ── 3. Tool calls (audit/observability) ─────────────────────

CREATE TABLE copilot_tool_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES copilot_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_use_id     TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  tool_input      JSONB NOT NULL DEFAULT '{}',
  tool_result     JSONB,
  status          TEXT NOT NULL
                    CHECK (status IN ('completed', 'error')),
  error_code      TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE copilot_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON copilot_tool_calls
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "members_read_own_tool_calls" ON copilot_tool_calls
  FOR SELECT USING (
    tenant_id = ANY(user_tenant_ids())
    AND conversation_id IN (
      SELECT id FROM copilot_conversations
      WHERE user_id = (auth.jwt()->>'email')
    )
  );

CREATE INDEX ctc_tenant_tool_time_idx ON copilot_tool_calls(tenant_id, tool_name, created_at DESC);
CREATE INDEX ctc_message_idx          ON copilot_tool_calls(message_id);
CREATE INDEX ctc_status_idx           ON copilot_tool_calls(status);

-- NOTE: tenant_members.copilot_enabled NÃO é adicionado.
-- O modelo de permission MVP é admin-only via JWT.role no app layer.
-- Per-user opt-in fica para spec futuro quando JWT tiver 'sub' real.
