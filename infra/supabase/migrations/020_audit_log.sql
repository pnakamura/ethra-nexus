-- Migration 020: create audit_log table referenced by getBudgetAlertsFired
-- Safe: IF NOT EXISTS

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id),
  entity_type  TEXT        NOT NULL,
  entity_id    TEXT        NOT NULL,
  action       TEXT        NOT NULL,
  actor        TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}',
  user_ip      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_id_idx ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx    ON audit_log(entity_type, entity_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
