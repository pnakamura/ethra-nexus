import { pgTable, uuid, text, timestamp, integer, index } from 'drizzle-orm/pg-core'
import { tenants, agents } from './core'
import { copilotConversations } from './copilot'
import { parsedFiles } from './parsing'

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  conversation_id: uuid('conversation_id').notNull()
    .references(() => copilotConversations.id, { onDelete: 'cascade' }),
  parsed_id: uuid('parsed_id').references(() => parsedFiles.id, { onDelete: 'set null' }),
  storage_key: text('storage_key').notNull(),
  sha256: text('sha256').notNull(),
  size_bytes: integer('size_bytes').notNull(),
  mime_type: text('mime_type').notNull().default('text/html'),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  generated_by_agent_id: uuid('generated_by_agent_id').notNull().references(() => agents.id),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  artifactsTenantIdx: index('artifacts_tenant_idx').on(table.tenant_id),
  artifactsConversationIdx: index('artifacts_conversation_idx').on(table.conversation_id),
  artifactsExpiresIdx: index('artifacts_expires_idx').on(table.expires_at),
}))
