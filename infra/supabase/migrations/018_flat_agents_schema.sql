-- Migration 018: sync flat agent columns with Drizzle schema
-- Safe: ADD COLUMN IF NOT EXISTS with defaults, no data rewrite

-- tenants: add password_hash for JWT-based auth (replaces Supabase Auth)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- agents: add flat columns that replaced the JSONB config structure
ALTER TABLE agents ADD COLUMN IF NOT EXISTS role           TEXT NOT NULL DEFAULT 'support';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS model          TEXT NOT NULL DEFAULT 'claude-sonnet-4-6';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt  TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS budget_monthly NUMERIC(10,2) NOT NULL DEFAULT 50.00;
