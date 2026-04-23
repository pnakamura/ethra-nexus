-- Migration 013: wiki runtime — config por agente + link de write-back
-- Safe: apenas ADD COLUMN com DEFAULT, sem rewrite de dados existentes

ALTER TABLE agents ADD COLUMN wiki_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE agents ADD COLUMN wiki_top_k INTEGER NOT NULL DEFAULT 5;
ALTER TABLE agents ADD COLUMN wiki_min_score NUMERIC(4,2) NOT NULL DEFAULT 0.72;
ALTER TABLE agents ADD COLUMN wiki_write_mode TEXT NOT NULL DEFAULT 'supervised';

ALTER TABLE wiki_agent_writes ADD COLUMN aios_event_id UUID REFERENCES aios_events(id);
