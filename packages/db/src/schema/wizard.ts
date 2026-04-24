import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core'
import { tenants, agents } from './core'

// clone_wizard_sessions — sessões de entrevista para bootstrap de wiki (Fase 22C)
// questions: [{index: number, text: string}]
// answers:   [{question_index: number, answer: string}]
export const cloneWizardSessions = pgTable(
  'clone_wizard_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agent_id: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('active'),
    questions: jsonb('questions').notNull().default([]),
    answers: jsonb('answers').notNull().default([]),
    pages_created: integer('pages_created').default(0),
    created_at: timestamp('created_at').defaultNow().notNull(),
    completed_at: timestamp('completed_at'),
  },
  (table) => ({
    cwsAgentIdx: index('cws_agent_idx').on(table.agent_id),
    cwsTenantIdx: index('cws_tenant_idx').on(table.tenant_id),
  }),
)
