import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  numeric,
  index,
} from 'drizzle-orm/pg-core'
import { tenants, agents } from './core'

// aios_events — audit trail de execução do AIOS Master Orchestrator
// Toda task executada gera um evento rastreável (LGPD art. 37)
//
// Mapeado para migration 009 (schema final, incorpora 004 + 006)
// Excluído: duration_ms (GENERATED ALWAYS AS no DB — Drizzle não insere em colunas geradas)
// triggered_by: text (sem FK para auth.users — sistema usa JWT, não Supabase Auth)
export const aiosEvents = pgTable(
  'aios_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agent_id: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    skill_id: text('skill_id').notNull(),
    activation_mode: text('activation_mode').notNull().default('on_demand'),
    activation_source: text('activation_source'),
    payload: jsonb('payload').notNull().default({}),
    result: jsonb('result'),
    status: text('status').notNull().default('pending'),
    retryable: boolean('retryable').notNull().default(false),
    error_code: text('error_code'),
    tokens_used: integer('tokens_used').notNull().default(0),
    cost_usd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    triggered_by: text('triggered_by'),
    user_ip: text('user_ip'),
    user_agent: text('user_agent'),
    triggered_at: timestamp('triggered_at').defaultNow().notNull(),
    started_at: timestamp('started_at').defaultNow().notNull(),
    completed_at: timestamp('completed_at'),
  },
  (table) => ({
    aiosEventsStatusIdx: index('aios_events_tenant_status_idx').on(
      table.tenant_id,
      table.status,
      table.started_at,
    ),
    aiosEventsAgentIdx: index('aios_events_agent_idx').on(table.agent_id, table.started_at),
  }),
)
