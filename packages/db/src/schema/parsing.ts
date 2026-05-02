import { pgTable, uuid, text, timestamp, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { tenants } from './core'

export const parsedFiles = pgTable('parsed_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  sha256: text('sha256').notNull(),
  format: text('format').notNull(),
  structured_json: jsonb('structured_json').notNull(),
  preview_md: text('preview_md').notNull(),
  pages_or_sheets: integer('pages_or_sheets').notNull().default(0),
  warnings: jsonb('warnings').notNull().default([]),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  parsedFilesTenantShaIdx: uniqueIndex('parsed_files_tenant_sha_idx').on(table.tenant_id, table.sha256),
  parsedFilesTenantIdx: index('parsed_files_tenant_idx').on(table.tenant_id),
  parsedFilesFormatIdx: index('parsed_files_format_idx').on(table.format),
}))
