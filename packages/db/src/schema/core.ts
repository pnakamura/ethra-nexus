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
} from 'drizzle-orm/pg-core'

// ============================================================
// Core Schema — 11 tabelas do Ethra Nexus
//
// Todas as tabelas incluem tenant_id para isolamento multi-tenant.
// O isolamento é garantido pelo hook onRequest do Fastify,
// que injeta tenantId do JWT em toda query.
//
// Referência: EthraNexus_Conceito_Completo_v1.md seção 4.1
// ============================================================

// ── Tenants ─────────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  password_hash: text('password_hash'),
  plan: text('plan').notNull().default('self-hosted'),
  settings: jsonb('settings').default({}),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ── Agents ──────────────────────────────────────────────────

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  role: text('role').notNull(),
  model: text('model').notNull().default('claude-sonnet-4-6'),
  system_prompt: text('system_prompt').notNull().default(''),
  status: text('status').notNull().default('active'),
  budget_monthly: numeric('budget_monthly', { precision: 10, scale: 2 }).notNull().default('50.00'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  agentsTenantSlugIdx: uniqueIndex('agents_tenant_slug_idx').on(table.tenant_id, table.slug),
  agentsTenantIdIdx: index('agents_tenant_id_idx').on(table.tenant_id),
}))

// ── Goals — hierarquia C→P→SP→PT ────────────────────────────

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  parent_id: uuid('parent_id'),  // self-FK, null = root
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  priority: integer('priority').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  goalsTenantIdIdx: index('goals_tenant_id_idx').on(table.tenant_id),
  goalsParentIdIdx: index('goals_parent_id_idx').on(table.parent_id),
}))

// ── Tickets — tarefas atômicas com rastreamento de custo ────

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').references(() => agents.id),
  goal_id: uuid('goal_id').references(() => goals.id),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('open'),
  rejection_reason: text('rejection_reason'),
  thread: jsonb('thread').default([]),
  tokens_used: integer('tokens_used').notNull().default(0),
  cost_usd: numeric('cost_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  ticketsTenantIdIdx: index('tickets_tenant_id_idx').on(table.tenant_id),
  ticketsAgentIdIdx: index('tickets_agent_id_idx').on(table.agent_id),
  ticketsStatusIdx: index('tickets_status_idx').on(table.status),
}))

// ── Sessions — contexto persistente entre heartbeats ────────

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  ticket_id: uuid('ticket_id').references(() => tickets.id),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  heartbeat_at: timestamp('heartbeat_at').defaultNow().notNull(),
  context: jsonb('context').default({}),
  status: text('status').notNull().default('active'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  sessionsAgentIdIdx: index('sessions_agent_id_idx').on(table.agent_id),
}))

// ── Budgets — orçamento mensal por agente ───────────────────

export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  month: text('month').notNull(),  // 'YYYY-MM'
  limit_usd: numeric('limit_usd', { precision: 10, scale: 2 }).notNull().default('50.00'),
  spent_usd: numeric('spent_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  tokens_used: integer('tokens_used').notNull().default(0),
  throttled_at: timestamp('throttled_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  budgetsAgentMonthIdx: uniqueIndex('budgets_agent_month_idx').on(table.agent_id, table.month),
  budgetsTenantIdIdx: index('budgets_tenant_id_idx').on(table.tenant_id),
}))

// ── Audit Log — registro imutável (LGPD) ───────────────────

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  action: text('action').notNull(),
  actor: text('actor').notNull(),
  payload: jsonb('payload').default({}),
  user_ip: text('user_ip'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  auditLogTenantIdIdx: index('audit_log_tenant_id_idx').on(table.tenant_id),
  auditLogEntityIdx: index('audit_log_entity_idx').on(table.entity_type, table.entity_id),
}))

// ── Provider Usage Log — custo por chamada LLM ──────────────

export const providerUsageLog = pgTable('provider_usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').references(() => agents.id),
  skill_id: text('skill_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  tokens_in: integer('tokens_in').notNull().default(0),
  tokens_out: integer('tokens_out').notNull().default(0),
  cost_usd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  latency_ms: integer('latency_ms'),
  is_fallback: boolean('is_fallback').notNull().default(false),
  is_sensitive: boolean('is_sensitive').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  pulTenantIdIdx: index('pul_tenant_id_idx').on(table.tenant_id),
  pulAgentIdIdx: index('pul_agent_id_idx').on(table.agent_id),
}))

// ── Agent Skills — skills associadas a cada agente ──────────

export const agentSkills = pgTable('agent_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  skill_name: text('skill_name').notNull(),
  skill_config: jsonb('skill_config').default({}),
  enabled: boolean('enabled').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  agentSkillsUniqueIdx: uniqueIndex('agent_skills_unique_idx').on(table.agent_id, table.skill_name),
}))

// ── Agent Tools — ferramentas MCP por agente ────────────────

export const agentTools = pgTable('agent_tools', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  tool_name: text('tool_name').notNull(),
  tool_config: jsonb('tool_config').default({}),
  enabled: boolean('enabled').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  agentToolsUniqueIdx: uniqueIndex('agent_tools_unique_idx').on(table.agent_id, table.tool_name),
}))

// ── Org Chart — hierarquia de reporte entre agentes ─────────

export const orgChart = pgTable('org_chart', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  agent_id: uuid('agent_id').notNull().references(() => agents.id),
  parent_agent_id: uuid('parent_agent_id').references(() => agents.id),
  reporting_line: text('reporting_line'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  orgChartAgentIdx: uniqueIndex('org_chart_agent_idx').on(table.tenant_id, table.agent_id),
}))
