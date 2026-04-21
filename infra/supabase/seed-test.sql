-- infra/supabase/seed-test.sql
-- Seed idempotente para testes E2E.
-- Executar uma vez na VPS antes dos testes E2E.
-- UUIDs fixos: facilita teardown e cross-referência nos testes.

INSERT INTO tenants (id, name, slug)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Test Org',   'test-org'),
  ('00000000-0000-0000-0000-000000000002', 'Other Org',  'other-org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (id, tenant_id, name, slug, status, model, system_prompt, budget_monthly)
VALUES (
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'Test Agent', 'test-agent', 'active',
  'claude-sonnet-4-6',
  'Você é um assistente de teste.',
  1.00
)
ON CONFLICT (id) DO NOTHING;

-- Agente do tenant B (para teste de isolamento)
INSERT INTO agents (id, tenant_id, name, slug, status, model, system_prompt, budget_monthly)
VALUES (
  '00000000-0000-0000-0002-000000000001',
  '00000000-0000-0000-0000-000000000002',
  'Other Tenant Agent', 'other-agent', 'active',
  'claude-sonnet-4-6',
  'Agente do outro tenant.',
  1.00
)
ON CONFLICT (id) DO NOTHING;
