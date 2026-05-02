-- ============================================================
-- 024_input_worker_and_parsing.sql
-- Input Worker Agent + Parsed Files Cache (Spec #3)
-- Novas tabelas: `parsed_files` (cache de parser output por sha256).
-- Coluna nova: agents.is_system (flag para agentes do sistema).
-- Seed: um agente `input-worker` por tenant com skill `data:extract`.
-- Safe: nova tabela + coluna nullable (sem rewrite, sem default backfill).
--
-- SEGURANÇA:
-- - RLS habilitado em `parsed_files` (sem policies).
-- - App conecta como superuser `postgres`; isolamento de tenant
--   é garantido pela camada de aplicação via `request.tenantId`
--   extraído do JWT — ver CLAUDE.md §4.1.
-- - agents.is_system impede UI delete/edit; INSERT/UPDATE só via SQL
--   para aios-master, input-worker, output-worker (futura).
-- ============================================================

-- ── 1. Coluna nova em agents ──────────────────────────────────
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN agents.is_system IS
  'TRUE = agente do sistema (aios-master, input-worker, output-worker). UI esconde edit/delete; INSERT/UPDATE direto via SQL.';

-- ── 2. Marca aios-master existentes como system (Spec #1 retroativo) ──
UPDATE agents SET is_system = TRUE WHERE slug = 'aios-master';

-- ── 3. Tabela `parsed_files` ──────────────────────────────────
CREATE TABLE IF NOT EXISTS parsed_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  format          TEXT NOT NULL CHECK (format IN ('xlsx','pdf','docx','csv','txt','md')),
  structured_json JSONB NOT NULL,
  preview_md      TEXT NOT NULL,
  pages_or_sheets INTEGER NOT NULL DEFAULT 0,
  warnings        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS parsed_files_tenant_sha_idx
  ON parsed_files(tenant_id, sha256);
CREATE INDEX IF NOT EXISTS parsed_files_tenant_idx
  ON parsed_files(tenant_id);
CREATE INDEX IF NOT EXISTS parsed_files_format_idx
  ON parsed_files(format);

ALTER TABLE parsed_files ENABLE ROW LEVEL SECURITY;

-- ── 4. Seed input-worker agent por tenant ─────────────────────
INSERT INTO agents (
  tenant_id, name, slug, role, model, system_prompt, status,
  budget_monthly, wiki_enabled, wiki_top_k, wiki_min_score, wiki_write_mode,
  a2a_enabled, response_language, tone, is_system
)
SELECT
  t.id, 'Input Worker', 'input-worker', 'specialist:parser',
  'claude-sonnet-4-6',
  $$Você é o Input Worker, agente especialista do Ethra Nexus em parsing de arquivos.
Sua única responsabilidade é executar a skill data:extract — receber file_id de um anexo
do tenant, buscar bytes via driver, dispatchar pro parser correto via mime_type, e
retornar (ou cachear via sha256) o preview_md + structured_json.

Você NÃO interpreta dados nem responde ao usuário direto. Apenas estrutura.
Interpretação é responsabilidade do AIOS Master.$$,
  'active',
  20.00,
  FALSE, 5, 0.72, 'manual',
  FALSE, 'pt-BR', 'professional', TRUE
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM agents a WHERE a.tenant_id = t.id AND a.slug = 'input-worker'
);

-- ── 5. Habilitar skill data:extract pro input-worker ──────────
INSERT INTO agent_skills (agent_id, tenant_id, skill_name, enabled)
SELECT a.id, a.tenant_id, 'data:extract', TRUE
FROM agents a
WHERE a.slug = 'input-worker'
  AND NOT EXISTS (
    SELECT 1 FROM agent_skills s WHERE s.agent_id = a.id AND s.skill_name = 'data:extract'
  );
