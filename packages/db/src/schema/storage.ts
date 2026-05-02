import { pgTable, uuid, text, timestamp, jsonb, bigint, index } from 'drizzle-orm/pg-core'
import { tenants } from './core'

// ── Files — binary asset registry ───────────────────────────

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  storage_key: text('storage_key').notNull(),
  mime_type: text('mime_type').notNull(),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  original_filename: text('original_filename'),
  uploaded_by: text('uploaded_by').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  filesTenantIdx: index('files_tenant_id_idx').on(table.tenant_id),
  filesSha256Idx: index('files_sha256_idx').on(table.sha256),
  // partial index files_tenant_expires_idx tracked in SQL only — Drizzle doesn't model partial indexes well
}))

// ── System Alerts — alerts fired by the monitor/budget engine ─

export const systemAlerts = pgTable('system_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  category: text('category').notNull(),
  code: text('code').notNull(),
  severity: text('severity').notNull(),  // 'info' | 'warning' | 'critical' enforced by SQL CHECK
  message: text('message').notNull(),
  payload: jsonb('payload').notNull().default({}),
  fired_at: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  systemAlertsFiredAtIdx: index('system_alerts_fired_at_idx').on(table.fired_at),
  // unique partial index system_alerts_one_active_idx tracked in SQL only
}))
