-- ============================================================
-- 003_wiki.sql
-- Hierarquia de wikis: system (Tier 0) + por agente (Tier 1)
-- Padrão Karpathy: raw → wiki → embeddings
-- ============================================================

-- ============================================================
-- wiki_raw_sources — fontes brutas imutáveis
-- ============================================================

CREATE TABLE wiki_raw_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wiki_scope        text NOT NULL,       -- 'system' | 'agent-{slug}'
  agent_id          uuid REFERENCES agents(id) ON DELETE SET NULL,
  filename          text NOT NULL,
  file_path         text NOT NULL,       -- path relativo em wikis/{scope}/raw/
  file_type         text NOT NULL
                    CHECK (file_type IN ('pdf', 'md', 'txt', 'docx', 'url', 'xlsx')),
  file_size_bytes   bigint NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'done', 'error')),
  pages_generated   integer NOT NULL DEFAULT 0,
  error_message     text,
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wiki_raw_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON wiki_raw_sources
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON wiki_raw_sources
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- wiki_pages — conhecimento compilado pelo LLM
-- Namespacado por tenant + wiki_scope
-- ============================================================

CREATE TABLE wiki_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wiki_scope  text NOT NULL,             -- 'system' | 'agent-{slug}'
  agent_id    uuid REFERENCES agents(id) ON DELETE SET NULL,
  path        text NOT NULL,             -- ex: 'entidades/empresa-abc'
  title       text NOT NULL,
  content     text NOT NULL,
  embedding   vector(768),               -- gerado pelo pipeline de embeddings
  frontmatter jsonb NOT NULL DEFAULT '{
    "type": "conceito",
    "confidence": "media",
    "sources": [],
    "tags": [],
    "related": []
  }',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wiki_scope, path)
);

ALTER TABLE wiki_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON wiki_pages
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_members_read" ON wiki_pages
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "tenant_admins_write" ON wiki_pages
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'member')
    )
  );

-- Índice vetorial para busca semântica por escopo
CREATE INDEX wiki_pages_embedding_idx
  ON wiki_pages USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX wiki_pages_scope_idx ON wiki_pages(tenant_id, wiki_scope);
CREATE INDEX wiki_pages_type_idx ON wiki_pages((frontmatter->>'type'));

CREATE TRIGGER wiki_pages_updated_at
  BEFORE UPDATE ON wiki_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- search_wiki — busca semântica com escopo controlado
-- ============================================================

CREATE OR REPLACE FUNCTION search_wiki(
  p_tenant_id        uuid,
  p_query_embedding  vector(768),
  p_scopes           text[],          -- ex: ['system', 'agent-atendimento']
  p_threshold        float DEFAULT 0.7,
  p_limit            int   DEFAULT 8
)
RETURNS TABLE (
  wiki_scope  text,
  path        text,
  title       text,
  content     text,
  page_type   text,
  similarity  float
)
LANGUAGE sql STABLE AS $$
  SELECT
    wp.wiki_scope,
    wp.path,
    wp.title,
    wp.content,
    wp.frontmatter->>'type' AS page_type,
    1 - (wp.embedding <=> p_query_embedding) AS similarity
  FROM wiki_pages wp
  WHERE
    wp.tenant_id = p_tenant_id
    AND wp.wiki_scope = ANY(p_scopes)
    AND wp.embedding IS NOT NULL
    AND 1 - (wp.embedding <=> p_query_embedding) > p_threshold
  ORDER BY wp.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

-- ============================================================
-- wiki_operation_log — log append-only de operações
-- ============================================================

CREATE TABLE wiki_operation_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wiki_scope  text NOT NULL,
  operation   text NOT NULL CHECK (operation IN ('ingest', 'query', 'lint', 'edit')),
  summary     text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wiki_operation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON wiki_operation_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "tenant_admins_read" ON wiki_operation_log
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
