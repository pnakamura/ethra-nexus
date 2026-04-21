-- infra/supabase/migrations/011_aios_events_depth.sql
-- Migration 011: call_depth e parent_event_id em aios_events
-- Safe: apenas ADD COLUMN com DEFAULT — sem downtime, sem lock de escrita

ALTER TABLE aios_events
  ADD COLUMN IF NOT EXISTS call_depth INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_event_id UUID REFERENCES aios_events(id) ON DELETE SET NULL;

COMMENT ON COLUMN aios_events.call_depth IS
  'Profundidade de orquestração multi-agente. 0 = chamada direta, N = Nª geração de chain via event bus.';

COMMENT ON COLUMN aios_events.parent_event_id IS
  'ID do aios_event que originou esta chamada via event bus. Null para chamadas diretas.';

CREATE INDEX IF NOT EXISTS aios_events_call_depth_idx ON aios_events(call_depth)
  WHERE call_depth > 0;

CREATE INDEX IF NOT EXISTS aios_events_parent_event_id_idx ON aios_events(parent_event_id)
  WHERE parent_event_id IS NOT NULL;
