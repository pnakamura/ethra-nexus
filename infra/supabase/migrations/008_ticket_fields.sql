-- Migration 008: add description and rejection_reason to tickets
-- Safe: nullable columns with no NOT NULL constraint, no impact on existing rows.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rejection_reason text;
