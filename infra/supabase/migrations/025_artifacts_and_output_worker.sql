-- Migration 025: Output Worker agent + artifacts table (Spec #4)
-- Safe: nova tabela + INSERT idempotente. Sem rewrite, sem ALTER.
--
-- Padrão de RLS: enabled mas sem policies (mesmo Spec #1+#2+#3). App conecta
-- como superuser; isolamento via tenant_id em queries Drizzle (CLAUDE.md §4.1).

-- ── 1. artifacts table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  parsed_id       UUID REFERENCES parsed_files(id) ON DELETE SET NULL,
  storage_key     TEXT NOT NULL,
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes >= 0),
  mime_type       TEXT NOT NULL DEFAULT 'text/html',
  title           TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  generated_by_agent_id UUID NOT NULL REFERENCES agents(id),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifacts_tenant_idx       ON artifacts(tenant_id);
CREATE INDEX IF NOT EXISTS artifacts_conversation_idx ON artifacts(conversation_id);
CREATE INDEX IF NOT EXISTS artifacts_expires_idx      ON artifacts(expires_at);

ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;

-- ── 2. Seed output-worker agent por tenant ──────────────────────
INSERT INTO agents (
  tenant_id, name, slug, role, model, system_prompt, status,
  budget_monthly, wiki_enabled, wiki_top_k, wiki_min_score, wiki_write_mode,
  a2a_enabled, response_language, tone, is_system
)
SELECT
  t.id, 'Output Worker', 'output-worker', 'specialist:renderer',
  'claude-sonnet-4-6',
  $$Você é o Output Worker, agente especialista do Ethra Nexus em renderização de dashboards.
Sua única responsabilidade é executar a skill data:render — receber dados já queried + um prompt
de renderização, gerar HTML standalone com gráficos via chart.js (CDN jsdelivr), validar e salvar
como artifact.

Você NÃO interpreta dados nem responde ao usuário direto. Apenas renderiza.
Síntese e interpretação são do AIOS Master.

REGRAS DE OUTPUT:
- HTML standalone com <!DOCTYPE html>
- chart.js de https://cdn.jsdelivr.net/npm/chart.js@4 somente
- ZERO fetch() ou XHR no script (CSP bloqueará)
- Charts renderizam em <canvas>, dados embutidos como JSON inline
- Estilo profissional, mobile-friendly, contraste WCAG AA
- Tamanho máximo: 50KB do HTML final$$,
  'active',
  100.00,
  FALSE, 5, 0.72, 'manual',
  FALSE, 'pt-BR', 'professional', TRUE
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM agents a WHERE a.tenant_id = t.id AND a.slug = 'output-worker'
);

-- ── 3. Habilitar skill data:render pro output-worker ──────────
INSERT INTO agent_skills (agent_id, tenant_id, skill_name, enabled)
SELECT a.id, a.tenant_id, 'data:render', TRUE
FROM agents a
WHERE a.slug = 'output-worker'
  AND NOT EXISTS (
    SELECT 1 FROM agent_skills s WHERE s.agent_id = a.id AND s.skill_name = 'data:render'
  );
