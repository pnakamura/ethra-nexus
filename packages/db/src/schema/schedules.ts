import {
  pgTable, uuid, text, timestamp, jsonb, boolean,
  integer, numeric, index,
} from 'drizzle-orm/pg-core'
import { tenants, agents } from './core'

export const agentSchedules = pgTable('agent_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  skill_id: text('skill_id').notNull(),
  cron_expression: text('cron_expression').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  input: jsonb('input').notNull().default({}),
  output_channel: text('output_channel').notNull().default('api'),
  enabled: boolean('enabled').notNull().default(true),
  last_run_at: timestamp('last_run_at'),
  next_run_at: timestamp('next_run_at').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  schedulesNextRunIdx: index('schedules_next_run_at_idx').on(table.next_run_at),
  schedulesAgentIdx: index('schedules_agent_id_idx').on(table.agent_id),
  schedulesTenantIdx: index('schedules_tenant_id_idx').on(table.tenant_id),
}))

export const agentEventSubscriptions = pgTable('agent_event_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  event_type: text('event_type').notNull(),
  event_filter: jsonb('event_filter').notNull().default({}),
  skill_id: text('skill_id').notNull(),
  input: jsonb('input').notNull().default({}),
  output_channel: text('output_channel').notNull().default('api'),
  enabled: boolean('enabled').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  eventSubsAgentIdx: index('event_subs_agent_id_idx').on(table.agent_id),
  eventSubsTypeIdx: index('event_subs_event_type_idx').on(table.event_type),
  eventSubsTenantIdx: index('event_subs_tenant_id_idx').on(table.tenant_id),
}))

export const scheduledResults = pgTable('scheduled_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  schedule_id: uuid('schedule_id').references(() => agentSchedules.id, { onDelete: 'set null' }),
  skill_id: text('skill_id').notNull(),
  answer: text('answer').notNull(),
  tokens_used: integer('tokens_used').notNull().default(0),
  cost_usd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  triggered_at: timestamp('triggered_at').defaultNow().notNull(),
}, (table) => ({
  scheduledResultsTenantIdx: index('scheduled_results_tenant_id_idx').on(table.tenant_id),
  scheduledResultsScheduleIdx: index('scheduled_results_schedule_id_idx').on(table.schedule_id),
}))
