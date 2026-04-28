-- Migration 012: Copilot tables for AIOS Master Agent (Spec #1)
-- Safe: only adds new tables and one nullable-defaulted column

CREATE TABLE copilot_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         TEXT NOT NULL,
  agent_id        UUID NOT NULL REFERENCES agents(id),
  title           TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  message_count   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE copilot_conversations ENABLE ROW LEVEL SECURITY;
CREATE INDEX cc_tenant_user_recent_idx ON copilot_conversations(tenant_id, user_id, last_message_at DESC);
CREATE INDEX cc_tenant_status_idx      ON copilot_conversations(tenant_id, status);

CREATE TABLE copilot_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  role            TEXT NOT NULL,
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
CREATE INDEX cm_conv_time_idx   ON copilot_messages(conversation_id, created_at);
CREATE INDEX cm_tenant_role_idx ON copilot_messages(tenant_id, role);

CREATE TABLE copilot_tool_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES copilot_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  tool_use_id     TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  tool_input      JSONB NOT NULL DEFAULT '{}',
  tool_result     JSONB,
  status          TEXT NOT NULL,
  error_code      TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE copilot_tool_calls ENABLE ROW LEVEL SECURITY;
CREATE INDEX ctc_tenant_tool_time_idx ON copilot_tool_calls(tenant_id, tool_name, created_at DESC);
CREATE INDEX ctc_message_idx          ON copilot_tool_calls(message_id);
CREATE INDEX ctc_status_idx           ON copilot_tool_calls(status);

ALTER TABLE tenant_members ADD COLUMN IF NOT EXISTS copilot_enabled BOOLEAN NOT NULL DEFAULT FALSE;
