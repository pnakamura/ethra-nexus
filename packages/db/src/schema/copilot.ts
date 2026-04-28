import {
  pgTable, uuid, text, timestamp, jsonb, integer, numeric, index,
} from 'drizzle-orm/pg-core'
import { tenants, agents } from './core'

export const copilotConversations = pgTable('copilot_conversations', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  user_id:         text('user_id').notNull(),
  agent_id:        uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  title:           text('title'),
  status:          text('status').notNull().default('active'),
  message_count:   integer('message_count').notNull().default(0),
  total_tokens:    integer('total_tokens').notNull().default(0),
  total_cost_usd:  numeric('total_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  last_message_at: timestamp('last_message_at').notNull().defaultNow(),
  created_at:      timestamp('created_at').notNull().defaultNow(),
  updated_at:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantUserRecent: index('cc_tenant_user_recent_idx').on(t.tenant_id, t.user_id, t.last_message_at),
  tenantStatus:     index('cc_tenant_status_idx').on(t.tenant_id, t.status),
}))

export const copilotMessages = pgTable('copilot_messages', {
  id:              uuid('id').primaryKey().defaultRandom(),
  conversation_id: uuid('conversation_id').notNull().references(() => copilotConversations.id, { onDelete: 'cascade' }),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  role:            text('role').notNull(),
  content:         jsonb('content').notNull(),
  model:           text('model'),
  tokens_in:       integer('tokens_in').notNull().default(0),
  tokens_out:      integer('tokens_out').notNull().default(0),
  cost_usd:        numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  stop_reason:     text('stop_reason'),
  error_code:      text('error_code'),
  created_at:      timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  convTime: index('cm_conv_time_idx').on(t.conversation_id, t.created_at),
}))

export const copilotToolCalls = pgTable('copilot_tool_calls', {
  id:              uuid('id').primaryKey().defaultRandom(),
  message_id:      uuid('message_id').notNull().references(() => copilotMessages.id, { onDelete: 'cascade' }),
  conversation_id: uuid('conversation_id').notNull().references(() => copilotConversations.id, { onDelete: 'cascade' }),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  tool_use_id:     text('tool_use_id').notNull(),
  tool_name:       text('tool_name').notNull(),
  tool_input:      jsonb('tool_input').notNull().default({}),
  tool_result:     jsonb('tool_result'),
  status:          text('status').notNull(),
  error_code:      text('error_code'),
  duration_ms:     integer('duration_ms').notNull().default(0),
  created_at:      timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantToolTime: index('ctc_tenant_tool_time_idx').on(t.tenant_id, t.tool_name, t.created_at),
  message:        index('ctc_message_idx').on(t.message_id),
  status:         index('ctc_status_idx').on(t.status),
}))
