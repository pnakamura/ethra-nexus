-- Migration 023: file storage + system alerts (Spec #2)
-- Safe: novas tabelas + uma coluna nullable em tenants (sem rewrite, sem default backfill)

-- ── 1. Coluna nova em tenants ─────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS storage_limit_bytes BIGINT
  CHECK (storage_limit_bytes IS NULL OR storage_limit_bytes > 0);
COMMENT ON COLUMN tenants.storage_limit_bytes IS
  'Hard limit em bytes. NULL = ilimitado (default self-hosted).';

-- ── 2. Tabela `files` ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
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
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
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
