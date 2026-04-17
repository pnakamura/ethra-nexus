-- ============================================================
-- Ethra Nexus — Setup para PostgreSQL existente (Easypanel)
--
-- Execute este arquivo INTEIRO no PostgreSQL via Easypanel
-- ou via psql:
--   psql "SUA_CONNECTION_STRING" -f easypanel-setup.sql
--
-- Pré-requisito: extensão pgvector já instalada
-- ============================================================

-- ── Extensões ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── Schemas ──────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS n8n;

-- ── Roles para RLS ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- ── Auth functions ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claim.sub', true)::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  );
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'anon');
$$;

-- Se a tabela auth.users não existir, criar uma versão mínima
-- (necessária para FK em tenant_members)
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- ── Helper functions ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_tenant_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(tenant_id), '{}'::uuid[])
  FROM tenant_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.user_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_members
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


-- ══════════════════════════════════════════════════════════════
-- TABELAS
-- ══════════════════════════════════════════════════════════════

-- ── 001: tenants ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  plan       text NOT NULL DEFAULT 'self-hosted'
             CHECK (plan IN ('self-hosted','cloud-free','cloud-pro','enterprise')),
  config     jsonb NOT NULL DEFAULT '{}',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS tenants_updated_at ON tenants;
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS tenant_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  invited_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;

-- ── 002: agents ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  slug           text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  status         text NOT NULL DEFAULT 'setup'
                 CHECK (status IN ('setup','active','paused','budget_exceeded','error','archived')),
  description    text,
  avatar_url     text,
  tags           text[] NOT NULL DEFAULT '{}',
  wiki_scope     text NOT NULL,
  config         jsonb NOT NULL DEFAULT '{}',
  last_active_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS agents_tenant_status_idx ON agents(tenant_id, status);

CREATE TABLE IF NOT EXISTS agent_budget_periods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  total_spend_usd  numeric(10,4) NOT NULL DEFAULT 0,
  total_tokens     bigint NOT NULL DEFAULT 0,
  total_calls      integer NOT NULL DEFAULT 0,
  budget_limit_usd numeric(10,4) NOT NULL,
  alerts_triggered jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, period_start)
);
ALTER TABLE agent_budget_periods ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS agent_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel     text NOT NULL,
  external_id text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  started_at  timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  skill_id        text,
  wiki_pages_used text[] DEFAULT '{}',
  tokens_used     integer DEFAULT 0,
  cost_usd        numeric(10,6) DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS agent_messages_conv_idx ON agent_messages(conversation_id, created_at);

-- ── 003: wiki ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wiki_raw_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wiki_scope      text NOT NULL,
  agent_id        uuid REFERENCES agents(id) ON DELETE SET NULL,
  filename        text NOT NULL,
  file_path       text NOT NULL,
  file_type       text NOT NULL CHECK (file_type IN ('pdf','md','txt','docx','url','xlsx')),
  file_size_bytes bigint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','error')),
  pages_generated integer NOT NULL DEFAULT 0,
  error_message   text,
  processed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wiki_raw_sources ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wiki_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wiki_scope  text NOT NULL,
  agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL,
  path        text NOT NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  embedding   vector(768),
  frontmatter jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wiki_scope, path)
);
ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS wiki_pages_embedding_idx
  ON wiki_pages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS wiki_pages_scope_idx ON wiki_pages(tenant_id, wiki_scope);

DROP TRIGGER IF EXISTS wiki_pages_updated_at ON wiki_pages;
CREATE TRIGGER wiki_pages_updated_at BEFORE UPDATE ON wiki_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Busca semântica
CREATE OR REPLACE FUNCTION search_wiki(
  p_tenant_id uuid, p_query_embedding vector(768),
  p_scopes text[], p_threshold float DEFAULT 0.7, p_limit int DEFAULT 8
)
RETURNS TABLE (wiki_scope text, path text, title text, content text, page_type text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT wp.wiki_scope, wp.path, wp.title, wp.content,
         wp.frontmatter->>'type', 1 - (wp.embedding <=> p_query_embedding)
  FROM wiki_pages wp
  WHERE wp.tenant_id = p_tenant_id
    AND wp.wiki_scope = ANY(p_scopes)
    AND wp.embedding IS NOT NULL
    AND 1 - (wp.embedding <=> p_query_embedding) > p_threshold
  ORDER BY wp.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

CREATE TABLE IF NOT EXISTS wiki_operation_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wiki_scope text NOT NULL,
  operation  text NOT NULL CHECK (operation IN ('ingest','query','lint','edit')),
  summary    text NOT NULL,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wiki_operation_log ENABLE ROW LEVEL SECURITY;

-- ── 004: aios_events ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aios_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         uuid REFERENCES agents(id) ON DELETE SET NULL,
  skill_id         text NOT NULL,
  activation_mode  text NOT NULL,
  activation_source text,
  payload          jsonb NOT NULL DEFAULT '{}',
  result           jsonb,
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','ok','error')),
  tokens_used      integer NOT NULL DEFAULT 0,
  cost_usd         numeric(10,6) NOT NULL DEFAULT 0,
  retryable        boolean NOT NULL DEFAULT false,
  error_code       text,
  triggered_by     uuid,
  user_ip          inet,
  user_agent       text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
ALTER TABLE aios_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS aios_events_tenant_idx ON aios_events(tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS aios_events_agent_idx ON aios_events(agent_id, started_at DESC);

CREATE OR REPLACE FUNCTION get_agent_spend_current_period(p_agent_id uuid, p_period_start timestamptz)
RETURNS TABLE (total_usd numeric, total_tokens bigint) LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(cost_usd), 0)::numeric, COALESCE(SUM(tokens_used), 0)::bigint
  FROM aios_events WHERE agent_id = p_agent_id AND status = 'ok' AND started_at >= p_period_start;
$$;

-- ── 005: provider_usage_log ──────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_usage_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id          uuid REFERENCES agents(id) ON DELETE SET NULL,
  module_id         text NOT NULL,
  provider          text NOT NULL CHECK (provider IN ('anthropic','openrouter')),
  model             text NOT NULL,
  input_tokens      integer NOT NULL DEFAULT 0,
  output_tokens     integer NOT NULL DEFAULT 0,
  latency_ms        integer NOT NULL DEFAULT 0,
  is_fallback       boolean NOT NULL DEFAULT false,
  is_sensitive_data boolean NOT NULL DEFAULT false,
  estimated_cost_usd numeric(10,6) DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE provider_usage_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS provider_usage_tenant_idx ON provider_usage_log(tenant_id, created_at DESC);


-- ══════════════════════════════════════════════════════════════
-- RLS POLICIES (service_role bypass + tenant isolation)
-- ══════════════════════════════════════════════════════════════

-- Macro: cria policy de service_role + leitura por tenant para cada tabela
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'tenants','tenant_members','agents','agent_budget_periods',
      'agent_conversations','agent_messages',
      'wiki_raw_sources','wiki_pages','wiki_operation_log',
      'aios_events','provider_usage_log'
    ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service_full" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "service_full" ON %I FOR ALL USING (current_setting(''request.jwt.claim.role'', true) = ''service_role'')',
      tbl
    );
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- SEED: Tenant inicial (self-hosted)
-- ══════════════════════════════════════════════════════════════

INSERT INTO tenants (name, slug, plan, config)
VALUES (
  'Minha Organização',
  'minha-org',
  'self-hosted',
  '{
    "features": {"whatsapp":true,"email":true,"webhook_api":true,"custom_providers":true,"sso":false,"audit_log":true},
    "limits": {"max_agents":999,"max_wiki_pages":99999,"max_raw_sources_mb":10240,"max_monthly_ai_calls":999999},
    "default_provider": "anthropic",
    "default_model": "claude-sonnet-4-6",
    "timezone": "America/Sao_Paulo",
    "locale": "pt-BR"
  }'
)
ON CONFLICT (slug) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
DO $$ BEGIN RAISE NOTICE '✅ Ethra Nexus — banco configurado com sucesso!'; END $$;
