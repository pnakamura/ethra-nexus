-- ============================================================
-- 007_wiki_raw_sources.sql
-- Audit log de ingestões de documentos na wiki
--
-- Propósito: rastreabilidade LGPD de fontes de conhecimento.
-- NÃO é uma fila de polling — o ingest é disparado na origem
-- (Google Drive via N8N, upload via UI futura, chamada direta à API).
-- ============================================================

CREATE TABLE IF NOT EXISTS wiki_raw_sources (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  file_type        text        NOT NULL,
  source_url       text,
  source_origin    text        NOT NULL DEFAULT 'api'
                               CHECK (source_origin IN ('api', 'google_drive', 'upload', 'n8n')),
  status           text        NOT NULL DEFAULT 'processing'
                               CHECK (status IN ('processing', 'done', 'failed')),
  pages_extracted  integer,
  pages_persisted  integer,
  error_msg        text,
  ingested_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE wiki_raw_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON wiki_raw_sources
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX wrse_tenant_idx ON wiki_raw_sources (tenant_id);
CREATE INDEX wrse_status_idx ON wiki_raw_sources (status);
