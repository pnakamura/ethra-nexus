-- ============================================================
-- seed.sql — Tenant inicial para self-hosted / desenvolvimento
-- Executar UMA VEZ após as migrations:
--   psql $DATABASE_URL -f infra/supabase/seed.sql
-- ============================================================

INSERT INTO tenants (name, slug, plan, password_hash, is_active)
VALUES (
  'Minha Organização',
  'minha-org',
  'self-hosted',
  '$2a$12$NJm3c6569HtFxt/QUfZYQOeDdB/.l2WNPGyoVHCLoQwqUop7geXm.',
  true
)
ON CONFLICT (slug) DO NOTHING;
