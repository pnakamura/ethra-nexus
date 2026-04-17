import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  boolean,
  uniqueIndex,
  index,
  customType,
} from 'drizzle-orm/pg-core'
import { tenants, agents, tickets } from './core'

// ============================================================
// Wiki Schema — 4 tabelas do subsistema wiki
//
// Arquitetura de duas wikis (conceito Karpathy):
//   - Wiki estratégica: conhecimento compartilhado por tenant
//   - Wiki individual: aprendizado privado por agente
//
// Referência: EthraNexus_Conceito_Completo_v1.md seção 4.2
// ============================================================

// ── Tipo customizado para pgvector ──────────────────────────

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)'
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/[\[\]]/g, '')
      .split(',')
      .map(Number)
  },
})

// ── Wiki Strategic Pages — wiki compartilhada por tenant ────

export const wikiStrategicPages = pgTable('wiki_strategic_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull().default('conceito'),
  content: text('content').notNull().default(''),
  sources: jsonb('sources').default([]),
  tags: jsonb('tags').default([]),
  confidence: text('confidence').notNull().default('pendente'),
  status: text('status').notNull().default('ativo'),
  promoted_from_id: uuid('promoted_from_id'),
  author_type: text('author_type').notNull().default('human'),
  valid_until: timestamp('valid_until'),
  embedding: vector('embedding'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  wspTenantSlugIdx: uniqueIndex('wsp_tenant_slug_idx').on(table.tenant_id, table.slug),
  wspTenantTypeIdx: index('wsp_tenant_type_idx').on(table.tenant_id, table.type),
}))

// ── Wiki Agent Pages — wiki individual por agente ───────────

export const wikiAgentPages = pgTable('wiki_agent_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  type: text('type').notNull().default('padrao'),
  content: text('content').notNull().default(''),
  origin: text('origin'),
  confidence: text('confidence').notNull().default('pendente'),
  status: text('status').notNull().default('ativo'),
  promoted_at: timestamp('promoted_at'),
  embedding: vector('embedding'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  wapAgentSlugIdx: uniqueIndex('wap_agent_slug_idx').on(table.agent_id, table.slug),
  wapTenantIdIdx: index('wap_tenant_id_idx').on(table.tenant_id),
}))

// ── Wiki Operations Log — audit trail de operações wiki ─────

export const wikiOperationsLog = pgTable('wiki_operations_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').references(() => agents.id),
  operation: text('operation').notNull(),
  scope: text('scope').notNull(),
  target_page_id: uuid('target_page_id'),
  summary: text('summary').notNull(),
  metadata: jsonb('metadata').default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  wolTenantIdIdx: index('wol_tenant_id_idx').on(table.tenant_id),
  wolOperationIdx: index('wol_operation_idx').on(table.operation),
}))

// ── Wiki Agent Writes — staging de propostas de agentes ─────

export const wikiAgentWrites = pgTable('wiki_agent_writes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  target_wiki: text('target_wiki').notNull().default('agent'),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  type: text('type').notNull().default('padrao'),
  status: text('status').notNull().default('draft'),
  reviewed_by: text('reviewed_by'),
  reviewed_at: timestamp('reviewed_at'),
  origin_ticket_id: uuid('origin_ticket_id').references(() => tickets.id),
  metadata: jsonb('metadata').default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  wawTenantIdIdx: index('waw_tenant_id_idx').on(table.tenant_id),
  wawStatusIdx: index('waw_status_idx').on(table.status),
  wawAgentIdIdx: index('waw_agent_id_idx').on(table.agent_id),
}))
