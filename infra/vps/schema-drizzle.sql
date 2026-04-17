-- ============================================================
-- Ethra Nexus — Schema Drizzle (Fase 1)
-- 15 tabelas (11 core + 4 wiki) + extensões + índice HNSW
--
-- Aplicar no banco `ethra-nexus` (não no `postgres`):
--   psql -U postgres -d ethra-nexus -f schema-drizzle.sql
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- CORE TABLES (11)
-- ============================================================

-- ── Tenants ─────────────────────────────────────────────────
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'self-hosted',
  settings jsonb DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ── Agents ──────────────────────────────────────────────────
CREATE TABLE agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  slug text NOT NULL,
  role text NOT NULL,
  model text NOT NULL DEFAULT 'claude-sonnet-4-6',
  system_prompt text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  budget_monthly numeric(10, 2) NOT NULL DEFAULT 50.00,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agents_tenant_slug_idx ON agents (tenant_id, slug);
CREATE INDEX agents_tenant_id_idx ON agents (tenant_id);

-- ── Goals — hierarquia C→P→SP→PT ────────────────────────────
CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  parent_id uuid,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  priority integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX goals_tenant_id_idx ON goals (tenant_id);
CREATE INDEX goals_parent_id_idx ON goals (parent_id);

-- ── Tickets ─────────────────────────────────────────────────
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_id uuid REFERENCES agents(id),
  goal_id uuid REFERENCES goals(id),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  thread jsonb DEFAULT '[]',
  tokens_used integer NOT NULL DEFAULT 0,
  cost_usd numeric(10, 4) NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX tickets_tenant_id_idx ON tickets (tenant_id);
CREATE INDEX tickets_agent_id_idx ON tickets (agent_id);
CREATE INDEX tickets_status_idx ON tickets (status);

-- ── Sessions ────────────────────────────────────────────────
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  ticket_id uuid REFERENCES tickets(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  heartbeat_at timestamp NOT NULL DEFAULT now(),
  context jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX sessions_agent_id_idx ON sessions (agent_id);

-- ── Budgets ─────────────────────────────────────────────────
CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  month text NOT NULL,
  limit_usd numeric(10, 2) NOT NULL DEFAULT 50.00,
  spent_usd numeric(10, 4) NOT NULL DEFAULT 0,
  tokens_used integer NOT NULL DEFAULT 0,
  throttled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX budgets_agent_month_idx ON budgets (agent_id, month);
CREATE INDEX budgets_tenant_id_idx ON budgets (tenant_id);

-- ── Audit Log ───────────────────────────────────────────────
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  actor text NOT NULL,
  payload jsonb DEFAULT '{}',
  user_ip text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_id_idx ON audit_log (tenant_id);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);

-- ── Provider Usage Log ──────────────────────────────────────
CREATE TABLE provider_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_id uuid REFERENCES agents(id),
  skill_id text,
  provider text NOT NULL,
  model text NOT NULL,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  latency_ms integer,
  is_fallback boolean NOT NULL DEFAULT false,
  is_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX pul_tenant_id_idx ON provider_usage_log (tenant_id);
CREATE INDEX pul_agent_id_idx ON provider_usage_log (agent_id);

-- ── Agent Skills ────────────────────────────────────────────
CREATE TABLE agent_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  skill_name text NOT NULL,
  skill_config jsonb DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_skills_unique_idx ON agent_skills (agent_id, skill_name);

-- ── Agent Tools ─────────────────────────────────────────────
CREATE TABLE agent_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  tool_name text NOT NULL,
  tool_config jsonb DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_tools_unique_idx ON agent_tools (agent_id, tool_name);

-- ── Org Chart ───────────────────────────────────────────────
CREATE TABLE org_chart (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_id uuid NOT NULL REFERENCES agents(id),
  parent_agent_id uuid REFERENCES agents(id),
  reporting_line text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX org_chart_agent_idx ON org_chart (tenant_id, agent_id);

-- ============================================================
-- WIKI TABLES (4)
-- ============================================================

-- ── Wiki Strategic Pages ────────────────────────────────────
CREATE TABLE wiki_strategic_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  slug text NOT NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'conceito',
  content text NOT NULL DEFAULT '',
  sources jsonb DEFAULT '[]',
  tags jsonb DEFAULT '[]',
  confidence text NOT NULL DEFAULT 'pendente',
  status text NOT NULL DEFAULT 'ativo',
  promoted_from_id uuid,
  author_type text NOT NULL DEFAULT 'human',
  valid_until timestamp,
  embedding vector(1536),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wsp_tenant_slug_idx ON wiki_strategic_pages (tenant_id, slug);
CREATE INDEX wsp_tenant_type_idx ON wiki_strategic_pages (tenant_id, type);

-- ── Wiki Agent Pages ────────────────────────────────────────
CREATE TABLE wiki_agent_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  slug text NOT NULL,
  title text NOT NULL,
  type text NOT NULL DEFAULT 'padrao',
  content text NOT NULL DEFAULT '',
  origin text,
  confidence text NOT NULL DEFAULT 'pendente',
  status text NOT NULL DEFAULT 'ativo',
  promoted_at timestamp,
  embedding vector(1536),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wap_agent_slug_idx ON wiki_agent_pages (agent_id, slug);
CREATE INDEX wap_tenant_id_idx ON wiki_agent_pages (tenant_id);

-- ── Wiki Operations Log ─────────────────────────────────────
CREATE TABLE wiki_operations_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_id uuid REFERENCES agents(id),
  operation text NOT NULL,
  scope text NOT NULL,
  target_page_id uuid,
  summary text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX wol_tenant_id_idx ON wiki_operations_log (tenant_id);
CREATE INDEX wol_operation_idx ON wiki_operations_log (operation);

-- ── Wiki Agent Writes (staging) ─────────────────────────────
CREATE TABLE wiki_agent_writes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_id uuid NOT NULL REFERENCES agents(id),
  target_wiki text NOT NULL DEFAULT 'agent',
  slug text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  type text NOT NULL DEFAULT 'padrao',
  status text NOT NULL DEFAULT 'draft',
  reviewed_by text,
  reviewed_at timestamp,
  origin_ticket_id uuid REFERENCES tickets(id),
  metadata jsonb DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX waw_tenant_id_idx ON wiki_agent_writes (tenant_id);
CREATE INDEX waw_status_idx ON wiki_agent_writes (status);
CREATE INDEX waw_agent_id_idx ON wiki_agent_writes (agent_id);

-- ============================================================
-- HNSW INDEX (pgvector) — busca semântica
-- ============================================================
CREATE INDEX wsp_embedding_idx ON wiki_strategic_pages
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX wap_embedding_idx ON wiki_agent_pages
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================
-- SEED — tenant inicial
-- ============================================================
INSERT INTO tenants (id, name, slug, plan, settings)
VALUES (
  '62bbb28f-f707-425b-b6fb-833adb1e0bf6',
  'Minha Organização',
  'minha-org',
  'self-hosted',
  '{}'
);

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS total_tables,
  (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector_version,
  (SELECT count(*) FROM tenants) AS tenants_seeded;
