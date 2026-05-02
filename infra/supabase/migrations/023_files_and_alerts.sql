-- ============================================================
-- 023_files_and_alerts.sql
-- File Storage + System Alerts (Spec #2)
-- Novas tabelas: `files` (blob metadata + dedup via sha256) e
-- `system_alerts` (alertas dispatchados pelo orquestrador AIOS).
-- Coluna nova: tenants.storage_limit_bytes (nullable BIGINT).
-- Safe: novas tabelas + coluna nullable (sem rewrite, sem default backfill).
--
-- SEGURANÇA:
-- - RLS habilitado em `files` e `system_alerts` (sem policies).
-- - App conecta como superuser `postgres`; isolamento de tenant
--   é garantido pela camada de aplicação via `request.tenantId`
--   extraído do JWT — ver CLAUDE.md §4.1.
-- - As funções auth.jwt() / auth.role() / user_tenant_ids()
--   referenciadas na migration 021 são específicas do Supabase e
--   NÃO existem no Postgres 17 self-hosted usado em produção
--   (auditoria Spec #1, 2026-04-28). Adicionar policies que as
--   referenciem faria o apply falhar — portanto nenhuma policy
--   é criada aqui. Não reabrir esta decisão sem checar o ambiente.
--
-- INVARIANTE IMPORTANTE:
-- - O índice parcial único `system_alerts_one_active_idx`
--   (tenant_id, category, code) WHERE resolved_at IS NULL
--   garante exatamente um alerta ativo por (tenant, categoria, código).
--   Isso é um pré-requisito para `computeStorageAlerts` (Task 12),
--   que faz upsert baseado nessa unicidade.
-- ============================================================

-- ── 1. Coluna nova em tenants ─────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT
  CONSTRAINT tenants_storage_limit_positive CHECK (storage_limit_bytes IS NULL OR storage_limit_bytes > 0);
COMMENT ON COLUMN tenants.storage_limit_bytes IS
  'Hard limit em bytes. NULL = ilimitado (default self-hosted).';

-- ── 2. Tabela `files` ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),  -- ON DELETE RESTRICT (default): app layer must purge files before tenant delete
  storage_key     TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  original_filename TEXT,
  uploaded_by     TEXT NOT NULL,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS files_tenant_id_idx ON files(tenant_id);
CREATE INDEX IF NOT EXISTS files_tenant_expires_idx ON files(tenant_id, expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_sha256_idx ON files(sha256);

DROP TRIGGER IF EXISTS files_updated_at ON files;
CREATE TRIGGER files_updated_at BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- ── 3. Tabela `system_alerts` ─────────────────────────────────
CREATE TABLE IF NOT EXISTS system_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),  -- ON DELETE RESTRICT (default): resolve or delete alerts before tenant delete
  category      TEXT NOT NULL,
  code          TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  message       TEXT NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS system_alerts_one_active_idx
  ON system_alerts(tenant_id, category, code)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS system_alerts_tenant_active_idx
  ON system_alerts(tenant_id, resolved_at)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS system_alerts_fired_at_idx ON system_alerts(fired_at DESC);

ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
