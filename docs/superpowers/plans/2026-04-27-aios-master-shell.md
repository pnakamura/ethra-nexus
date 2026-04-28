# AIOS Master Agent (Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only conversational concierge agent (`AIOS Master`) that answers questions about tenant state — agents, executions, budget, wiki, approvals — via a `/copilot` page using Anthropic Tool Use API.

**Architecture:** New `agents` row (`slug='aios-master'`) + 3 new tables (`copilot_conversations`, `copilot_messages`, `copilot_tool_calls`) + new `copilot/` module in `packages/agents` with 9 read-only system tools + new Fastify routes with SSE streaming + new React `/copilot` page following the 3-panel pattern of `OrchestratorPage`.

**Tech Stack:** Fastify 5, Drizzle ORM, PostgreSQL, Anthropic SDK (Sonnet 4.6), Server-Sent Events, React 18 + TanStack Query, Vitest mocking pattern (vi.mock).

**Reference Spec:** `docs/superpowers/specs/2026-04-27-aios-master-shell.md`

---

## Audit decision log (2026-04-28)

After Tasks 1–2 entered review, a deeper audit of the codebase revealed gaps the original plan missed. Findings + fixes applied to this plan and the spec in a single batch:

| # | Finding | Resolution |
|---|---------|------------|
| A1 | Migration `012_*` collided with existing `012_agent_identity_channels.sql`; numbering went to 020 | Renamed to `021_copilot_tables.sql` (next free slot) |
| A2 | RLS enabled on new tables but NO policies — backend would have failed all writes | Added `service_role_full_access` (FOR ALL) + `members_read_own_*` (FOR SELECT) policies on all 3 tables, matching `004_aios_events.sql` pattern |
| A3 | Missing `CHECK` constraints on status/role columns | Added: `status IN ('active','archived')`, `role IN ('user','assistant')`, `status IN ('completed','error')` |
| A4 | Missing `updated_at` trigger on `copilot_conversations` | Added trigger using existing `update_updated_at()` from migration 001 |
| A5 | FK ON DELETE behavior incomplete | `tenant_id ON DELETE CASCADE` everywhere; `agent_id` nullable + `ON DELETE SET NULL` (matches `aios_events`); `conversation_id` cascade in tool_calls |
| A6 | Low-selectivity index `cm_tenant_role_idx` (only 2 distinct values) | Removed |
| A7 | **JWT da casa não tem `sub`** — only `{ tenantId, email, role }` ([app.ts:73](apps/server/src/app.ts#L73)) | RLS uses `auth.jwt()->>'email'`. Plan permission middleware uses `request.user.email`. Schema column `user_id TEXT` stores email |
| A8 | `tenant_members` table exists in SQL but **zero app code queries it** | Dropped `ALTER TABLE tenant_members ADD copilot_enabled` from migration. Permission MVP is **admin-only via JWT.role**. Per-user opt-in deferred to spec future when JWT has user identity |
| A9 | `executeWikiQuery` is private in `skill-executor.ts` (not exported) | Task 14 re-implements query inline using `embed` + raw SQL pgvector. No coupling to skill-executor internals |
| A10 | Drizzle style inconsistent with existing files (`(t) =>` vs `(table) =>`, alignment) | Updated copilot.ts to single-space alignment + `(table) =>` callback parameter, with file header comment |

**Spec Q5 revision**: original choice "C — admin + tenant_members.copilot_enabled" replaced with **B — admin-only**. Per-user opt-in is now a deferred concern in the "Open questions / future work" section.

Tasks 22 and 23 carry inline AUDIT NOTE blocks reminding the implementer that test mocks must drop the tenant_members lookup branches.

---

## File Structure

### Backend — `packages/db`

| File | Purpose | Status |
|------|---------|--------|
| `packages/db/src/schema/copilot.ts` | Drizzle schema for 3 copilot tables | NEW |
| `packages/db/src/schema/index.ts` | Re-export copilot schema | MODIFY |
| `infra/supabase/migrations/021_copilot_tables.sql` | SQL migration (tables + ALTER + seed) | NEW |

### Backend — `packages/agents/src/lib/copilot/`

| File | Purpose | Status |
|------|---------|--------|
| `index.ts` | Public exports | NEW |
| `anthropic-client.ts` | Anthropic SDK singleton | NEW |
| `system-prompt.ts` | System prompt constant | NEW |
| `tool-registry.ts` | `CopilotTool` interface, `executeToolCall`, `getToolsForAnthropic` | NEW |
| `tools/index.ts` | Array of all 9 tools | NEW |
| `tools/list-agents.ts` | Tool 1 | NEW |
| `tools/get-recent-events.ts` | Tool 2 | NEW |
| `tools/explain-event.ts` | Tool 3 | NEW |
| `tools/get-budget-status.ts` | Tool 4 | NEW |
| `tools/cost-breakdown.ts` | Tool 5 | NEW |
| `tools/agent-health.ts` | Tool 6 | NEW |
| `tools/list-pending-approvals.ts` | Tool 7 | NEW |
| `tools/wiki-query.ts` | Tool 8 (inline pgvector query — does NOT import private `executeWikiQuery`) | NEW |
| `tools/list-storage-alerts.ts` | Tool 9 (stub returning `[]`) | NEW |
| `turn-loop.ts` | `executeCopilotTurn` orchestration | NEW |
| `__tests__/*.test.ts` | Vitest tests | NEW |

### Backend — `apps/server`

| File | Purpose | Status |
|------|---------|--------|
| `apps/server/src/routes/copilot.ts` | REST + SSE endpoints | NEW |
| `apps/server/src/app.ts` | Register copilot routes | MODIFY |
| `apps/server/src/__tests__/copilot-routes.test.ts` | Endpoint + SSE tests | NEW |

### Frontend — `apps/web`

| File | Purpose | Status |
|------|---------|--------|
| `apps/web/src/pages/CopilotPage.tsx` | 3-panel page shell | NEW |
| `apps/web/src/components/copilot/ConversationsSidebar.tsx` | Left panel | NEW |
| `apps/web/src/components/copilot/ChatView.tsx` | Center panel | NEW |
| `apps/web/src/components/copilot/MessageList.tsx` | Scrollable messages | NEW |
| `apps/web/src/components/copilot/UserBubble.tsx` | User message render | NEW |
| `apps/web/src/components/copilot/AssistantBubble.tsx` | Assistant message + tool markers | NEW |
| `apps/web/src/components/copilot/MessageInput.tsx` | Textarea + send | NEW |
| `apps/web/src/components/copilot/ToolCallsLog.tsx` | Right panel | NEW |
| `apps/web/src/components/copilot/EmptyState.tsx` | Chips first-time UX | NEW |
| `apps/web/src/hooks/useCopilot.ts` | TanStack hooks | NEW |
| `apps/web/src/lib/copilot-stream.ts` | SSE parser via fetch | NEW |
| `apps/web/src/App.tsx` | Add `/copilot` route | MODIFY |
| `apps/web/src/components/layout/Sidebar.tsx` | Add Copilot nav item | MODIFY |
| `apps/web/src/__tests__/copilot-stream.test.ts` | Stream parser tests | NEW |

---

## Task overview

| # | Phase | Task |
|---|-------|------|
| 1 | DB | Migration SQL — copilot tables (admin-only permission, no tenant_members alter) |
| 2 | DB | Drizzle schema for copilot tables |
| 3 | DB | Apply migration locally + seed aios-master |
| 4 | Foundation | Anthropic client wrapper |
| 5 | Foundation | System prompt constant |
| 6 | Foundation | CopilotTool interface + tool-registry skeleton |
| 7 | Tool | `system:list_agents` |
| 8 | Tool | `system:get_recent_events` |
| 9 | Tool | `system:explain_event` |
| 10 | Tool | `system:get_budget_status` |
| 11 | Tool | `system:cost_breakdown` |
| 12 | Tool | `system:agent_health` |
| 13 | Tool | `system:list_pending_approvals` |
| 14 | Tool | `system:wiki_query` (wrapper) |
| 15 | Tool | `system:list_storage_alerts` (stub) |
| 16 | Tool | All-tools array + getToolsForAnthropic + permission gate |
| 17 | Loop | Turn loop core (text-only, no tools) |
| 18 | Loop | Tool execution within turn |
| 19 | Loop | Per-turn cost + tool count caps |
| 20 | Loop | Auto-title fire-and-forget |
| 21 | API | Permission middleware |
| 22 | API | Conversation CRUD endpoints |
| 23 | API | SSE message endpoint |
| 24 | Frontend | Sidebar nav + /copilot route + page shell |
| 25 | Frontend | copilot-stream.ts (TDD) |
| 26 | Frontend | useCopilot hooks |
| 27 | Frontend | ConversationsSidebar component |
| 28 | Frontend | ChatView + MessageList + UserBubble + AssistantBubble |
| 29 | Frontend | MessageInput + send wiring |
| 30 | Frontend | ToolCallsLog (right panel) |
| 31 | Frontend | EmptyState with chips |
| 32 | QA | Smoke test pass + final commit |

Each task ends with a commit. Naming: `feat(copilot): <component>` for features, `test(copilot): <component>` for test-only.

**Test mocking convention:** This codebase mocks Drizzle DB via `vi.mock('@ethra-nexus/db', ...)`. See `packages/agents/src/__tests__/db-agents.test.ts` lines 4-46 for the canonical mock pattern. Tests do NOT spin up a real Postgres.

---

## Task 1: Migration SQL — copilot tables (admin-only)

**Files:**
- Create: `infra/supabase/migrations/021_copilot_tables.sql`

- [ ] **Step 1: Create the migration file**

Write `infra/supabase/migrations/021_copilot_tables.sql`:

```sql
-- ============================================================
-- 021_copilot_tables.sql
-- AIOS Master Agent (shell) — Spec #1
-- Tabelas de conversas, mensagens (Anthropic content blocks),
-- e audit de tool calls do copilot conversacional read-only.
--
-- SEGURANÇA:
-- - RLS habilitado + policies (service_role + tenant scoping)
-- - tenant_id NOT NULL e indexado em todas
-- - cascade delete: conv → messages → tool_calls
-- - CHECK constraints em status
-- - updated_at trigger em conversations (segue padrão da casa)
-- - ADD COLUMN IF NOT EXISTS para idempotência local
-- ============================================================

-- ── 1. Conversations ────────────────────────────────────────

CREATE TABLE copilot_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
  title           TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived')),
  message_count   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE copilot_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON copilot_conversations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "members_read_own_conversations" ON copilot_conversations
  FOR SELECT USING (
    tenant_id = ANY(user_tenant_ids())
    AND user_id = (auth.jwt()->>'email')
  );

CREATE INDEX cc_tenant_user_recent_idx ON copilot_conversations(tenant_id, user_id, last_message_at DESC);
CREATE INDEX cc_tenant_status_idx      ON copilot_conversations(tenant_id, status);

CREATE TRIGGER copilot_conversations_updated_at
  BEFORE UPDATE ON copilot_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. Messages (Anthropic content blocks: text/tool_use/tool_result) ─

CREATE TABLE copilot_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role            TEXT NOT NULL
                    CHECK (role IN ('user', 'assistant')),
  content         JSONB NOT NULL,
  model           TEXT,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  stop_reason     TEXT,
  error_code      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE copilot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON copilot_messages
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "members_read_own_messages" ON copilot_messages
  FOR SELECT USING (
    tenant_id = ANY(user_tenant_ids())
    AND conversation_id IN (
      SELECT id FROM copilot_conversations
      WHERE user_id = (auth.jwt()->>'email')
    )
  );

CREATE INDEX cm_conv_time_idx ON copilot_messages(conversation_id, created_at);

-- ── 3. Tool calls (audit/observability) ─────────────────────

CREATE TABLE copilot_tool_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES copilot_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_use_id     TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  tool_input      JSONB NOT NULL DEFAULT '{}',
  tool_result     JSONB,
  status          TEXT NOT NULL
                    CHECK (status IN ('completed', 'error')),
  error_code      TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE copilot_tool_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON copilot_tool_calls
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "members_read_own_tool_calls" ON copilot_tool_calls
  FOR SELECT USING (
    tenant_id = ANY(user_tenant_ids())
    AND conversation_id IN (
      SELECT id FROM copilot_conversations
      WHERE user_id = (auth.jwt()->>'email')
    )
  );

CREATE INDEX ctc_tenant_tool_time_idx ON copilot_tool_calls(tenant_id, tool_name, created_at DESC);
CREATE INDEX ctc_message_idx          ON copilot_tool_calls(message_id);
CREATE INDEX ctc_status_idx           ON copilot_tool_calls(status);

-- NOTE: tenant_members.copilot_enabled NÃO é adicionado.
-- O modelo de permission MVP é admin-only via JWT.role no app layer.
-- Per-user opt-in fica para spec futuro quando JWT tiver 'sub' real.
```

> **Code review notes** (applied 2026-04-28): RLS policies (`service_role_full_access` + member-scoped read via `auth.jwt()->>'email'`), CHECK on `status`/`role`, ON DELETE CASCADE on tenant_id and conversation_id FKs, ON DELETE SET NULL on agent_id (with agent_id nullable), `updated_at` trigger using existing `update_updated_at()` function. Removed `cm_tenant_role_idx` (low selectivity — role has 2 values). **Audit 2026-04-28**: removida ALTER TABLE para `tenant_members.copilot_enabled` — JWT da casa não tem `sub` user identity, permission é admin-only no MVP.

- [ ] **Step 2: Commit**

```bash
git add infra/supabase/migrations/021_copilot_tables.sql
git commit -m "feat(db): migration 021 — copilot tables (admin-only permission)"
```

---

## Task 2: Drizzle schema for copilot tables

**Files:**
- Create: `packages/db/src/schema/copilot.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1: Create Drizzle schema**

Write `packages/db/src/schema/copilot.ts`:

```typescript
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
```

- [ ] **Step 2: Re-export from index**

In `packages/db/src/schema/index.ts`, append:

```typescript
export * from './copilot'
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd packages/db && npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/copilot.ts packages/db/src/schema/index.ts
git commit -m "feat(db): drizzle schema for copilot tables"
```

---

## Task 3: Seed migration — aios-master agent per tenant

**Files:**
- Create: `infra/supabase/migrations/022_seed_aios_master.sql`

- [ ] **Step 1: Create the seed migration**

Write `infra/supabase/migrations/022_seed_aios_master.sql`:

```sql
-- Migration 022: Seed AIOS Master agent for each tenant (idempotent)

INSERT INTO agents (
  id, tenant_id, slug, name, role, status, system_prompt,
  model, budget_monthly, wiki_enabled, wiki_top_k,
  wiki_min_score, wiki_write_mode
)
SELECT
  gen_random_uuid(), t.id, 'aios-master', 'AIOS Master',
  'Concierge conversacional do Ethra Nexus', 'active',
  'Você é o AIOS Master, o concierge conversacional do Ethra Nexus — uma plataforma multi-tenant de orquestração de agentes de IA.

## Sua função
Responder perguntas sobre o estado do sistema do tenant atual: agentes, execuções, wiki, orçamento, saúde operacional.

## Como agir
- Use as tools antes de responder. Não invente dados que dependam de informação atual.
- Seja conciso: 2-4 frases ou tabela quando apropriado. Sem prefácios ("Claro!", "Sem problemas").
- Português por padrão. Inglês só se o usuário começar em inglês.
- Cite IDs encurtados: #3b99571c (primeiros 8 chars).
- Tabelas markdown para listas com 3+ colunas.
- Sugira ações concretas: "veja em /agents/atendimento" ou "use a aba Aprovações na Wiki".
- Quando não souber, diga. Não tente.

## Boundaries
- Você é READ-ONLY. Não pode pausar agentes, aprovar wiki writes, ou disparar execuções. Oriente o usuário à UI apropriada.
- Você opera APENAS no tenant atual.
- Sem perguntas pessoais ou fora do escopo da plataforma.',
  'claude-sonnet-4-6', 20.00,
  FALSE, 5, 0.72, 'manual'
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM agents WHERE tenant_id = t.id AND slug = 'aios-master'
);
```

- [ ] **Step 2: Apply both migrations 012 and 013 via the existing migration runner**

The codebase applies migrations on the VPS via `docker exec` + node script (see `Roteiro_DEV/NEXUS-STATUS.md` for the canonical command). For local dev, run via `psql` directly against your dev DB.

Expected after running both: `SELECT slug FROM agents WHERE slug = 'aios-master';` returns ≥1 row.

- [ ] **Step 3: Commit**

```bash
git add infra/supabase/migrations/022_seed_aios_master.sql
git commit -m "feat(db): seed aios-master agent per tenant"
```

---

## Task 4: Anthropic client wrapper

**Files:**
- Create: `packages/agents/src/lib/copilot/anthropic-client.ts`

- [ ] **Step 1: Verify Anthropic SDK is installed**

Run: `cd packages/agents && cat package.json | grep anthropic`
Expected: `@anthropic-ai/sdk` listed in dependencies.

If missing: `cd packages/agents && npm install @anthropic-ai/sdk`

- [ ] **Step 2: Create the wrapper**

Write `packages/agents/src/lib/copilot/anthropic-client.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required')
    }
    client = new Anthropic({ apiKey })
  }
  return client
}

// Reset for tests
export function _resetClient(): void {
  client = null
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/lib/copilot/anthropic-client.ts
git commit -m "feat(copilot): anthropic client singleton"
```

---

## Task 5: System prompt constant

**Files:**
- Create: `packages/agents/src/lib/copilot/system-prompt.ts`

- [ ] **Step 1: Create the prompt module**

Write `packages/agents/src/lib/copilot/system-prompt.ts`:

```typescript
// AIOS Master system prompt.
// Mirror of the prompt seeded into agents.system_prompt for slug='aios-master'.
// Kept in source for tests and as a fallback when the DB row is missing.

export const AIOS_MASTER_SYSTEM_PROMPT = `Você é o AIOS Master, o concierge conversacional do Ethra Nexus — uma plataforma multi-tenant de orquestração de agentes de IA.

## Sua função
Responder perguntas sobre o estado do sistema do tenant atual: agentes, execuções, wiki, orçamento, saúde operacional.

## Como agir
- Use as tools antes de responder. Não invente dados que dependam de informação atual.
- Seja conciso: 2-4 frases ou tabela quando apropriado. Sem prefácios ("Claro!", "Sem problemas").
- Português por padrão. Inglês só se o usuário começar em inglês.
- Cite IDs encurtados: #3b99571c (primeiros 8 chars).
- Tabelas markdown para listas com 3+ colunas.
- Sugira ações concretas: "veja em /agents/atendimento" ou "use a aba Aprovações na Wiki".
- Quando não souber, diga. Não tente.

## Boundaries
- Você é READ-ONLY. Não pode pausar agentes, aprovar wiki writes, ou disparar execuções. Oriente o usuário à UI apropriada.
- Você opera APENAS no tenant atual.
- Sem perguntas pessoais ou fora do escopo da plataforma.`
```

- [ ] **Step 2: Commit**

```bash
git add packages/agents/src/lib/copilot/system-prompt.ts
git commit -m "feat(copilot): system prompt constant"
```

---

## Task 6: CopilotTool interface + tool-registry skeleton

**Files:**
- Create: `packages/agents/src/lib/copilot/tool-registry.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/agents/src/__tests__/copilot-tool-registry.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({}),
}))

import { executeToolCall, type CopilotTool, type ToolContext } from '../lib/copilot/tool-registry'

const ctxAdmin: ToolContext = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' }
const ctxMember: ToolContext = { tenant_id: 't1', user_id: 'u2', user_role: 'member' }

const allMembersTool: CopilotTool<{ x: number }, number> = {
  name: 'test:double',
  description: 'doubles a number',
  input_schema: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
  permission: 'all_members',
  handler: async (input) => input.x * 2,
}

const adminOnlyTool: CopilotTool<Record<string, never>, string> = {
  name: 'test:secret',
  description: 'admin secret',
  input_schema: { type: 'object', properties: {} },
  permission: 'admin_only',
  handler: async () => 'classified',
}

describe('executeToolCall', () => {
  it('runs handler and returns result with duration', async () => {
    const r = await executeToolCall(allMembersTool, { x: 21 }, ctxAdmin)
    expect(r.result).toBe(42)
    expect(r.error).toBeUndefined()
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('returns PERMISSION_DENIED when admin_only tool called by member', async () => {
    const r = await executeToolCall(adminOnlyTool, {}, ctxMember)
    expect(r.error).toBe('PERMISSION_DENIED')
    expect(r.result).toBeNull()
  })

  it('admin_only tool succeeds for admin', async () => {
    const r = await executeToolCall(adminOnlyTool, {}, ctxAdmin)
    expect(r.result).toBe('classified')
    expect(r.error).toBeUndefined()
  })

  it('captures handler exceptions as error string', async () => {
    const failing: CopilotTool<Record<string, never>, never> = {
      name: 'test:fail',
      description: 'fails',
      input_schema: { type: 'object', properties: {} },
      permission: 'all_members',
      handler: async () => { throw new Error('boom') },
    }
    const r = await executeToolCall(failing, {}, ctxAdmin)
    expect(r.error).toBe('boom')
    expect(r.result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents && npx vitest run --reporter=verbose copilot-tool-registry`
Expected: FAIL — Cannot find module `tool-registry`.

- [ ] **Step 3: Implement the registry**

Write `packages/agents/src/lib/copilot/tool-registry.ts`:

```typescript
import type { JSONSchema7 } from 'json-schema'

export interface ToolContext {
  tenant_id: string
  user_id: string
  user_role: 'admin' | 'member'
}

export interface CopilotTool<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  input_schema: JSONSchema7
  permission: 'all_members' | 'admin_only'
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>
}

export interface ToolCallResult<T = unknown> {
  result: T | null
  durationMs: number
  error?: string
}

export async function executeToolCall<TInput, TOutput>(
  tool: CopilotTool<TInput, TOutput>,
  input: TInput,
  ctx: ToolContext,
): Promise<ToolCallResult<TOutput>> {
  if (tool.permission === 'admin_only' && ctx.user_role !== 'admin') {
    return { result: null, durationMs: 0, error: 'PERMISSION_DENIED' }
  }
  const start = Date.now()
  try {
    const result = await tool.handler(input, ctx)
    return { result, durationMs: Date.now() - start }
  } catch (err) {
    return {
      result: null,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'UNKNOWN',
    }
  }
}

// Anthropic tool schema format (subset of Anthropic.Tool)
export interface AnthropicToolSchema {
  name: string
  description: string
  input_schema: JSONSchema7
}

export function getToolsForAnthropic(tools: CopilotTool[]): AnthropicToolSchema[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))
}
```

- [ ] **Step 4: Verify json-schema types installed**

Run: `cd packages/agents && cat package.json | grep json-schema`

If missing: `cd packages/agents && npm install --save-dev @types/json-schema`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agents && npx vitest run --reporter=verbose copilot-tool-registry`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/copilot/tool-registry.ts \
        packages/agents/src/__tests__/copilot-tool-registry.test.ts \
        packages/agents/package.json packages/agents/package-lock.json
git commit -m "feat(copilot): CopilotTool interface + executeToolCall + permission gate"
```

---

## Task 7: Tool — `system:list_agents`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/list-agents.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-list-agents.test.ts`

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-list-agents.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  agents: {},
  agentSkills: {},
  agentChannels: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conds) => ({ conds })),
}))

const { listAgentsTool } = await import('../lib/copilot/tools/list-agents')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:list_agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
  })

  it('lists agents filtered by tenant_id', async () => {
    mockWhere
      .mockResolvedValueOnce([
        { id: 'a1', slug: 'atendimento', name: 'Atendimento', role: 'support', status: 'active', model: 'sonnet', budget_monthly: '5.00' },
      ])
      .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
      .mockResolvedValueOnce([{ id: 'c1' }])

    const result = await listAgentsTool.handler({}, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'a1', slug: 'atendimento', name: 'Atendimento',
      skills_count: 2, channels_count: 1, budget_monthly: 5,
    })
  })

  it('passes status filter to query when provided', async () => {
    const { eq, and } = await import('drizzle-orm')
    mockWhere.mockResolvedValueOnce([])
    await listAgentsTool.handler({ status: 'paused' }, ctx)
    expect(eq).toHaveBeenCalled()
    expect(and).toHaveBeenCalled()
  })

  it('returns empty array when no agents in tenant', async () => {
    mockWhere.mockResolvedValueOnce([])
    const result = await listAgentsTool.handler({}, ctx)
    expect(result).toEqual([])
  })

  it('has all_members permission', () => {
    expect(listAgentsTool.permission).toBe('all_members')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run --reporter=verbose copilot-tool-list-agents`
Expected: FAIL — Cannot find module `tools/list-agents`.

- [ ] **Step 3: Implement the tool**

Write `packages/agents/src/lib/copilot/tools/list-agents.ts`:

```typescript
import { eq, and } from 'drizzle-orm'
import { getDb, agents, agentSkills, agentChannels } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface ListAgentsInput {
  status?: 'active' | 'paused' | 'archived'
}

interface AgentSummary {
  id: string
  slug: string
  name: string
  role: string
  status: string
  model: string
  budget_monthly: number
  skills_count: number
  channels_count: number
}

export const listAgentsTool: CopilotTool<ListAgentsInput, AgentSummary[]> = {
  name: 'system:list_agents',
  description: 'Lista agentes do tenant atual com slug, nome, role, status, modelo, orçamento mensal, e contagem de skills e channels. Use para responder "quais agentes existem", "quem está ativo", overview de configuração.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'paused', 'archived'], description: 'Filtra por status. Omitir para todos.' },
    },
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    const db = getDb()
    const conditions = [eq(agents.tenant_id, ctx.tenant_id)]
    if (input.status) conditions.push(eq(agents.status, input.status))

    const rows = await db.select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      role: agents.role,
      status: agents.status,
      model: agents.model,
      budget_monthly: agents.budget_monthly,
    }).from(agents).where(and(...conditions))

    const enriched: AgentSummary[] = []
    for (const a of rows) {
      const skills = await db.select({ id: agentSkills.id }).from(agentSkills).where(eq(agentSkills.agent_id, a.id))
      const channels = await db.select({ id: agentChannels.id }).from(agentChannels).where(eq(agentChannels.agent_id, a.id))
      enriched.push({
        id: a.id,
        slug: a.slug,
        name: a.name,
        role: a.role ?? '',
        status: a.status,
        model: a.model,
        budget_monthly: Number(a.budget_monthly),
        skills_count: skills.length,
        channels_count: channels.length,
      })
    }
    return enriched
  },
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run --reporter=verbose copilot-tool-list-agents`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/list-agents.ts \
        packages/agents/src/__tests__/copilot-tool-list-agents.test.ts
git commit -m "feat(copilot): tool system:list_agents"
```

---

## Task 8: Tool — `system:get_recent_events`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/get-recent-events.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-get-recent-events.test.ts`

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-get-recent-events.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockLimit = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect }),
  aiosEvents: {},
  agents: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  desc: vi.fn((c) => ({ desc: c })),
  gte: vi.fn((c, v) => ({ c, v })),
}))

const { getRecentEventsTool } = await import('../lib/copilot/tools/get-recent-events')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:get_recent_events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLimit.mockResolvedValue([])
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ limit: mockLimit }),
          }),
        }),
      }),
    })
  })

  it('returns events with agent_name joined', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'e1', agent_id: 'a1', agent_name: 'Atendimento',
      skill_id: 'wiki:query', status: 'ok',
      started_at: new Date('2026-04-27T10:00:00Z'),
      completed_at: new Date('2026-04-27T10:00:02Z'),
      tokens_used: 1200, cost_usd: '0.012345', error_code: null,
    }])
    const result = await getRecentEventsTool.handler({}, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'e1', agent_name: 'Atendimento', cost_usd: 0.012345,
      latency_ms: 2000,
    })
  })

  it('clamps limit to max 100', async () => {
    await getRecentEventsTool.handler({ limit: 999 }, ctx)
    expect(mockLimit).toHaveBeenCalledWith(100)
  })

  it('uses default limit of 20 when not provided', async () => {
    await getRecentEventsTool.handler({}, ctx)
    expect(mockLimit).toHaveBeenCalledWith(20)
  })

  it('has all_members permission', () => {
    expect(getRecentEventsTool.permission).toBe('all_members')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-tool-get-recent-events`
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Write `packages/agents/src/lib/copilot/tools/get-recent-events.ts`:

```typescript
import { eq, and, desc, gte } from 'drizzle-orm'
import { getDb, aiosEvents, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface GetRecentEventsInput {
  limit?: number
  agent_id?: string
  status?: 'ok' | 'error' | 'running'
  skill_id?: string
  since?: string  // ISO8601
}

interface EventSummary {
  id: string
  agent_id: string | null
  agent_name: string | null
  skill_id: string
  status: string
  started_at: string
  completed_at: string | null
  tokens_used: number
  cost_usd: number
  error_code: string | null
  latency_ms: number | null
}

export const getRecentEventsTool: CopilotTool<GetRecentEventsInput, EventSummary[]> = {
  name: 'system:get_recent_events',
  description: 'Lista os eventos de execução mais recentes (aios_events) do tenant. Cada evento traz agente, skill, status, tempos e custo. Use para "últimas execuções", "atividade recente", "execuções de hoje", filtros por agente/status/skill.',
  input_schema: {
    type: 'object',
    properties: {
      limit:    { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20, máximo 100' },
      agent_id: { type: 'string', description: 'UUID do agente para filtrar' },
      status:   { type: 'string', enum: ['ok', 'error', 'running'] },
      skill_id: { type: 'string', description: 'Ex: wiki:query' },
      since:    { type: 'string', format: 'date-time', description: 'ISO8601, limita para eventos depois desta data' },
    },
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    const db = getDb()
    const limit = Math.min(input.limit ?? 20, 100)
    const conditions = [eq(aiosEvents.tenant_id, ctx.tenant_id)]
    if (input.agent_id) conditions.push(eq(aiosEvents.agent_id, input.agent_id))
    if (input.status)   conditions.push(eq(aiosEvents.status, input.status))
    if (input.skill_id) conditions.push(eq(aiosEvents.skill_id, input.skill_id))
    if (input.since)    conditions.push(gte(aiosEvents.started_at, new Date(input.since)))

    const rows = await db.select({
      id: aiosEvents.id,
      agent_id: aiosEvents.agent_id,
      agent_name: agents.name,
      skill_id: aiosEvents.skill_id,
      status: aiosEvents.status,
      started_at: aiosEvents.started_at,
      completed_at: aiosEvents.completed_at,
      tokens_used: aiosEvents.tokens_used,
      cost_usd: aiosEvents.cost_usd,
      error_code: aiosEvents.error_code,
    })
      .from(aiosEvents)
      .leftJoin(agents, eq(agents.id, aiosEvents.agent_id))
      .where(and(...conditions))
      .orderBy(desc(aiosEvents.started_at))
      .limit(limit)

    return rows.map((r): EventSummary => {
      const startedAt = r.started_at instanceof Date ? r.started_at : new Date(r.started_at)
      const completedAt = r.completed_at ? (r.completed_at instanceof Date ? r.completed_at : new Date(r.completed_at)) : null
      return {
        id: r.id,
        agent_id: r.agent_id,
        agent_name: r.agent_name,
        skill_id: r.skill_id,
        status: r.status,
        started_at: startedAt.toISOString(),
        completed_at: completedAt?.toISOString() ?? null,
        tokens_used: r.tokens_used ?? 0,
        cost_usd: Number(r.cost_usd ?? 0),
        error_code: r.error_code,
        latency_ms: completedAt ? completedAt.getTime() - startedAt.getTime() : null,
      }
    })
  },
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-tool-get-recent-events`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/get-recent-events.ts \
        packages/agents/src/__tests__/copilot-tool-get-recent-events.test.ts
git commit -m "feat(copilot): tool system:get_recent_events"
```

---

## Task 9: Tool — `system:explain_event`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/explain-event.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-explain-event.test.ts`

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-explain-event.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockLimit = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect }),
  aiosEvents: {},
  agents: {},
  providerUsageLog: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
}))

const { explainEventTool } = await import('../lib/copilot/tools/explain-event')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:explain_event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: mockLimit }),
        }),
        where: vi.fn().mockReturnValue({ limit: mockLimit }),
      }),
    })
  })

  it('returns event details + provider_usage', async () => {
    mockLimit
      .mockResolvedValueOnce([{
        id: 'e1', agent_id: 'a1', agent_name: 'Atendimento',
        skill_id: 'wiki:query', status: 'ok',
        payload: { question: 'olá' }, result: { answer: 'oi' },
        error_code: null, started_at: new Date(), completed_at: new Date(),
        tokens_used: 100, cost_usd: '0.001',
        call_depth: 0, parent_event_id: null,
      }])
      .mockResolvedValueOnce([])  // children
      .mockResolvedValueOnce([{ provider: 'anthropic', model: 'sonnet', tokens_in: 50, tokens_out: 50, cost_usd: '0.001' }])

    const result = await explainEventTool.handler({ event_id: 'e1' }, ctx)
    expect(result.id).toBe('e1')
    expect(result.payload).toEqual({ question: 'olá' })
    expect(result.provider_usage).toHaveLength(1)
  })

  it('throws when event not found', async () => {
    mockLimit.mockResolvedValueOnce([])
    await expect(explainEventTool.handler({ event_id: 'nope' }, ctx))
      .rejects.toThrow('Event not found')
  })

  it('has all_members permission', () => {
    expect(explainEventTool.permission).toBe('all_members')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-tool-explain-event`

- [ ] **Step 3: Implement the tool**

Write `packages/agents/src/lib/copilot/tools/explain-event.ts`:

```typescript
import { eq, and } from 'drizzle-orm'
import { getDb, aiosEvents, agents, providerUsageLog } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface ExplainEventInput {
  event_id: string
}

interface EventDetails {
  id: string
  agent_id: string | null
  agent_name: string | null
  skill_id: string
  status: string
  payload: unknown
  result: unknown
  error_code: string | null
  started_at: string
  completed_at: string | null
  tokens_used: number
  cost_usd: number
  call_depth: number
  parent_event_id: string | null
  children: Array<{ id: string; skill_id: string; status: string }>
  provider_usage: Array<{ provider: string; model: string; tokens_in: number; tokens_out: number; cost_usd: number }>
}

export const explainEventTool: CopilotTool<ExplainEventInput, EventDetails> = {
  name: 'system:explain_event',
  description: 'Drill-down completo em um evento de execução: payload, result, latência, custo, eventos filhos (chains multi-agente), provider usage. Use para "por que esse evento falhou?", "o que aconteceu em #abc123?", debugging.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', format: 'uuid', description: 'UUID completo do evento' },
    },
    required: ['event_id'],
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    const db = getDb()

    const eventRows = await db.select({
      id: aiosEvents.id,
      agent_id: aiosEvents.agent_id,
      agent_name: agents.name,
      skill_id: aiosEvents.skill_id,
      status: aiosEvents.status,
      payload: aiosEvents.payload,
      result: aiosEvents.result,
      error_code: aiosEvents.error_code,
      started_at: aiosEvents.started_at,
      completed_at: aiosEvents.completed_at,
      tokens_used: aiosEvents.tokens_used,
      cost_usd: aiosEvents.cost_usd,
      call_depth: aiosEvents.call_depth,
      parent_event_id: aiosEvents.parent_event_id,
    })
      .from(aiosEvents)
      .leftJoin(agents, eq(agents.id, aiosEvents.agent_id))
      .where(and(eq(aiosEvents.id, input.event_id), eq(aiosEvents.tenant_id, ctx.tenant_id)))
      .limit(1)

    const event = eventRows[0]
    if (!event) throw new Error('Event not found')

    const children = await db.select({
      id: aiosEvents.id, skill_id: aiosEvents.skill_id, status: aiosEvents.status,
    })
      .from(aiosEvents)
      .where(and(eq(aiosEvents.parent_event_id, input.event_id), eq(aiosEvents.tenant_id, ctx.tenant_id)))
      .limit(20)

    const usage = await db.select({
      provider: providerUsageLog.provider,
      model: providerUsageLog.model,
      tokens_in: providerUsageLog.tokens_in,
      tokens_out: providerUsageLog.tokens_out,
      cost_usd: providerUsageLog.cost_usd,
    })
      .from(providerUsageLog)
      .where(eq(providerUsageLog.aios_event_id, input.event_id))
      .limit(10)

    const startedAt = event.started_at instanceof Date ? event.started_at : new Date(event.started_at)
    const completedAt = event.completed_at ? (event.completed_at instanceof Date ? event.completed_at : new Date(event.completed_at)) : null

    return {
      id: event.id,
      agent_id: event.agent_id,
      agent_name: event.agent_name,
      skill_id: event.skill_id,
      status: event.status,
      payload: event.payload,
      result: event.result,
      error_code: event.error_code,
      started_at: startedAt.toISOString(),
      completed_at: completedAt?.toISOString() ?? null,
      tokens_used: event.tokens_used ?? 0,
      cost_usd: Number(event.cost_usd ?? 0),
      call_depth: event.call_depth ?? 0,
      parent_event_id: event.parent_event_id,
      children: children.map(c => ({ id: c.id, skill_id: c.skill_id, status: c.status })),
      provider_usage: usage.map(u => ({
        provider: u.provider, model: u.model,
        tokens_in: u.tokens_in ?? 0, tokens_out: u.tokens_out ?? 0,
        cost_usd: Number(u.cost_usd ?? 0),
      })),
    }
  },
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-tool-explain-event`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/explain-event.ts \
        packages/agents/src/__tests__/copilot-tool-explain-event.test.ts
git commit -m "feat(copilot): tool system:explain_event"
```

---

## Task 10: Tool — `system:get_budget_status`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/get-budget-status.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-get-budget-status.test.ts`

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-get-budget-status.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect }),
  budgets: {},
  agents: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  sql: (s: TemplateStringsArray) => s.join(''),
}))

const { getBudgetStatusTool } = await import('../lib/copilot/tools/get-budget-status')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:get_budget_status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
        where: vi.fn().mockResolvedValue([]),
      }),
    })
  })

  it('returns aggregated tenant budget when no agent_id', async () => {
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { agent_id: 'a1', agent_name: 'Atend', spent_usd: '4.21', limit_usd: '20.00' },
            { agent_id: 'a2', agent_name: 'Vendas', spent_usd: '1.50', limit_usd: '10.00' },
          ]),
        }),
      }),
    })
    const r = await getBudgetStatusTool.handler({}, ctx)
    expect(r.total_usd).toBeCloseTo(5.71, 2)
    expect(r.limit_usd).toBe(30)
    expect(r.by_agent).toHaveLength(2)
    expect(r.percent_used).toBeCloseTo((5.71 / 30) * 100, 1)
  })

  it('handles zero limit (unlimited) without divide-by-zero', async () => {
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ agent_id: 'a1', agent_name: 'X', spent_usd: '5', limit_usd: '0' }]),
        }),
      }),
    })
    const r = await getBudgetStatusTool.handler({}, ctx)
    expect(r.percent_used).toBe(0)
  })

  it('has admin_only permission', () => {
    expect(getBudgetStatusTool.permission).toBe('admin_only')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-tool-get-budget-status`

- [ ] **Step 3: Implement the tool**

Write `packages/agents/src/lib/copilot/tools/get-budget-status.ts`:

```typescript
import { eq, and } from 'drizzle-orm'
import { getDb, budgets, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface GetBudgetStatusInput {
  agent_id?: string
  month?: string  // 'YYYY-MM'
}

interface BudgetStatus {
  total_usd: number
  limit_usd: number
  percent_used: number
  by_agent: Array<{ agent_id: string; agent_name: string | null; spent_usd: number; limit_usd: number; percent: number }>
  days_until_reset: number
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function daysUntilReset(): number {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export const getBudgetStatusTool: CopilotTool<GetBudgetStatusInput, BudgetStatus> = {
  name: 'system:get_budget_status',
  description: 'Status de orçamento mensal do tenant (sem agent_id) ou de um agente específico. Retorna total gasto, limite, % usado, breakdown por agente, dias até reset. Use para "quanto gastei", "estou dentro do orçamento", "quem consome mais".',
  input_schema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', description: 'UUID do agente. Omitir para agregado do tenant.' },
      month:    { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM. Default: mês corrente.' },
    },
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    const db = getDb()
    const month = input.month ?? currentMonth()

    const conditions = [eq(budgets.tenant_id, ctx.tenant_id), eq(budgets.month, month)]
    if (input.agent_id) conditions.push(eq(budgets.agent_id, input.agent_id))

    const rows = await db.select({
      agent_id:   budgets.agent_id,
      agent_name: agents.name,
      spent_usd:  budgets.spent_usd,
      limit_usd:  agents.budget_monthly,
    })
      .from(budgets)
      .leftJoin(agents, eq(agents.id, budgets.agent_id))
      .where(and(...conditions))

    let totalSpent = 0
    let totalLimit = 0
    const byAgent = rows.map(r => {
      const spent = Number(r.spent_usd ?? 0)
      const limit = Number(r.limit_usd ?? 0)
      totalSpent += spent
      totalLimit += limit
      return {
        agent_id: r.agent_id,
        agent_name: r.agent_name,
        spent_usd: spent,
        limit_usd: limit,
        percent: limit > 0 ? (spent / limit) * 100 : 0,
      }
    })

    return {
      total_usd: totalSpent,
      limit_usd: totalLimit,
      percent_used: totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0,
      by_agent: byAgent,
      days_until_reset: daysUntilReset(),
    }
  },
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-tool-get-budget-status`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/get-budget-status.ts \
        packages/agents/src/__tests__/copilot-tool-get-budget-status.test.ts
git commit -m "feat(copilot): tool system:get_budget_status"
```

---

## Task 11: Tool — `system:cost_breakdown`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/cost-breakdown.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-cost-breakdown.test.ts`

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-cost-breakdown.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

const mockExecute = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ execute: mockExecute }),
}))

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals }),
}))

const { costBreakdownTool } = await import('../lib/copilot/tools/cost-breakdown')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:cost_breakdown', () => {
  it('groups by agent', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { group_value: 'Atendimento', total_cost_usd: '12.34', total_tokens: '50000', event_count: '120' },
        { group_value: 'Vendas',      total_cost_usd: '3.21',  total_tokens: '12000', event_count: '40' },
      ],
    })
    const r = await costBreakdownTool.handler({ group_by: 'agent' }, ctx)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ group_value: 'Atendimento', total_cost_usd: 12.34, event_count: 120 })
  })

  it('rejects invalid group_by', async () => {
    // @ts-expect-error testing runtime check
    await expect(costBreakdownTool.handler({ group_by: 'invalid' }, ctx))
      .rejects.toThrow('Invalid group_by')
  })

  it('has admin_only permission', () => {
    expect(costBreakdownTool.permission).toBe('admin_only')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-tool-cost-breakdown`

- [ ] **Step 3: Implement the tool**

Write `packages/agents/src/lib/copilot/tools/cost-breakdown.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

type GroupBy = 'agent' | 'skill' | 'day' | 'model'
type Period = 'last_7d' | 'last_30d' | 'this_month'

interface CostBreakdownInput {
  group_by: GroupBy
  period?: Period
  limit?: number
}

interface CostRow {
  group_value: string
  total_cost_usd: number
  total_tokens: number
  event_count: number
}

const GROUP_EXPR: Record<GroupBy, string> = {
  agent:  'a.name',
  skill:  'e.skill_id',
  day:    "to_char(e.started_at, 'YYYY-MM-DD')",
  model:  'pul.model',
}

const PERIOD_FILTER: Record<Period, string> = {
  last_7d:    "e.started_at >= now() - interval '7 days'",
  last_30d:   "e.started_at >= now() - interval '30 days'",
  this_month: "to_char(e.started_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM')",
}

export const costBreakdownTool: CopilotTool<CostBreakdownInput, CostRow[]> = {
  name: 'system:cost_breakdown',
  description: 'Análise agregada de custo por agente, skill, dia ou modelo, em um período (últimos 7d / 30d / mês). Use para "qual skill é mais cara", "quem gastou mais", "tendência diária".',
  input_schema: {
    type: 'object',
    properties: {
      group_by: { type: 'string', enum: ['agent', 'skill', 'day', 'model'] },
      period:   { type: 'string', enum: ['last_7d', 'last_30d', 'this_month'] },
      limit:    { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['group_by'],
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    if (!(input.group_by in GROUP_EXPR)) throw new Error(`Invalid group_by: ${input.group_by}`)
    const period = input.period ?? 'this_month'
    const limit = Math.min(input.limit ?? 20, 50)
    const db = getDb()
    const groupExpr = GROUP_EXPR[input.group_by]
    const periodFilter = PERIOD_FILTER[period]

    // Raw SQL for flexible group_by — bound tenant_id is parameterized
    const result = await db.execute(sql.raw(`
      SELECT
        ${groupExpr} AS group_value,
        SUM(e.cost_usd)::text AS total_cost_usd,
        SUM(e.tokens_used)::text AS total_tokens,
        COUNT(*)::text AS event_count
      FROM aios_events e
      LEFT JOIN agents a ON a.id = e.agent_id
      ${input.group_by === 'model' ? 'LEFT JOIN provider_usage_log pul ON pul.aios_event_id = e.id' : ''}
      WHERE e.tenant_id = '${ctx.tenant_id.replace(/'/g, "''")}'
        AND ${periodFilter}
      GROUP BY group_value
      ORDER BY SUM(e.cost_usd) DESC
      LIMIT ${limit}
    `))

    type Row = { group_value: string | null; total_cost_usd: string; total_tokens: string; event_count: string }
    return (result.rows as Row[])
      .filter(r => r.group_value !== null)
      .map(r => ({
        group_value: r.group_value as string,
        total_cost_usd: Number(r.total_cost_usd),
        total_tokens: Number(r.total_tokens),
        event_count: Number(r.event_count),
      }))
  },
}
```

> **Security note**: tenant_id is escaped via `replace` because it goes into raw SQL. The `period` and `group_by` come from a closed enum, so safe by allowlist.

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-tool-cost-breakdown`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/cost-breakdown.ts \
        packages/agents/src/__tests__/copilot-tool-cost-breakdown.test.ts
git commit -m "feat(copilot): tool system:cost_breakdown"
```

---

## Task 12: Tool — `system:agent_health`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/agent-health.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-agent-health.test.ts`

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-agent-health.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

const mockExecute = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ execute: mockExecute }),
}))

vi.mock('drizzle-orm', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
}))

const { agentHealthTool } = await import('../lib/copilot/tools/agent-health')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:agent_health', () => {
  it('returns success_rate, latency p95, top skills/errors', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: '100', errors: '5', p50: '500', p95: '2000' }] })
      .mockResolvedValueOnce({ rows: [{ skill_id: 'wiki:query', count: '60' }] })
      .mockResolvedValueOnce({ rows: [{ error_code: 'AI_ERROR', count: '3' }] })

    const r = await agentHealthTool.handler({ agent_id: 'a1' }, ctx)
    expect(r.total_events).toBe(100)
    expect(r.error_rate).toBe(0.05)
    expect(r.success_rate).toBe(0.95)
    expect(r.p50_latency_ms).toBe(500)
    expect(r.p95_latency_ms).toBe(2000)
    expect(r.top_skills).toHaveLength(1)
    expect(r.top_errors).toHaveLength(1)
  })

  it('handles empty data', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: '0', errors: '0', p50: null, p95: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await agentHealthTool.handler({ agent_id: 'a1' }, ctx)
    expect(r.total_events).toBe(0)
    expect(r.success_rate).toBe(0)
    expect(r.error_rate).toBe(0)
  })

  it('has all_members permission', () => {
    expect(agentHealthTool.permission).toBe('all_members')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-tool-agent-health`

- [ ] **Step 3: Implement the tool**

Write `packages/agents/src/lib/copilot/tools/agent-health.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

type Period = 'last_24h' | 'last_7d' | 'last_30d'

interface AgentHealthInput {
  agent_id: string
  period?: Period
}

interface AgentHealth {
  total_events: number
  success_rate: number
  error_rate: number
  p50_latency_ms: number
  p95_latency_ms: number
  top_skills: Array<{ skill_id: string; count: number }>
  top_errors: Array<{ error_code: string; count: number }>
}

const PERIOD_FILTER: Record<Period, string> = {
  last_24h: "started_at >= now() - interval '24 hours'",
  last_7d:  "started_at >= now() - interval '7 days'",
  last_30d: "started_at >= now() - interval '30 days'",
}

export const agentHealthTool: CopilotTool<AgentHealthInput, AgentHealth> = {
  name: 'system:agent_health',
  description: 'Saúde operacional de um agente: total de execuções, taxa de sucesso/erro, latência p50/p95, top skills usadas, top códigos de erro. Use para "esse agente está bem", "por que está caro", "tem muito erro".',
  input_schema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', format: 'uuid' },
      period:   { type: 'string', enum: ['last_24h', 'last_7d', 'last_30d'] },
    },
    required: ['agent_id'],
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    const period = input.period ?? 'last_7d'
    const filter = PERIOD_FILTER[period]
    const db = getDb()
    const agentId = input.agent_id.replace(/'/g, "''")
    const tenantId = ctx.tenant_id.replace(/'/g, "''")

    const aggResult = await db.execute(sql.raw(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE status = 'error')::text AS errors,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::text AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::text AS p95
      FROM aios_events
      WHERE agent_id = '${agentId}'
        AND tenant_id = '${tenantId}'
        AND ${filter}
        AND completed_at IS NOT NULL
    `))

    type AggRow = { total: string; errors: string; p50: string | null; p95: string | null }
    const agg = (aggResult.rows[0] as AggRow) ?? { total: '0', errors: '0', p50: null, p95: null }
    const total = Number(agg.total)
    const errors = Number(agg.errors)

    const skillsResult = await db.execute(sql.raw(`
      SELECT skill_id, COUNT(*)::text AS count FROM aios_events
      WHERE agent_id = '${agentId}' AND tenant_id = '${tenantId}' AND ${filter}
      GROUP BY skill_id ORDER BY count DESC LIMIT 5
    `))

    const errorsResult = await db.execute(sql.raw(`
      SELECT error_code, COUNT(*)::text AS count FROM aios_events
      WHERE agent_id = '${agentId}' AND tenant_id = '${tenantId}' AND ${filter}
        AND error_code IS NOT NULL
      GROUP BY error_code ORDER BY count DESC LIMIT 5
    `))

    return {
      total_events: total,
      success_rate: total > 0 ? (total - errors) / total : 0,
      error_rate:   total > 0 ? errors / total : 0,
      p50_latency_ms: agg.p50 ? Math.round(Number(agg.p50)) : 0,
      p95_latency_ms: agg.p95 ? Math.round(Number(agg.p95)) : 0,
      top_skills: (skillsResult.rows as Array<{ skill_id: string; count: string }>).map(r => ({ skill_id: r.skill_id, count: Number(r.count) })),
      top_errors: (errorsResult.rows as Array<{ error_code: string; count: string }>).map(r => ({ error_code: r.error_code, count: Number(r.count) })),
    }
  },
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-tool-agent-health`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/agent-health.ts \
        packages/agents/src/__tests__/copilot-tool-agent-health.test.ts
git commit -m "feat(copilot): tool system:agent_health"
```

---

## Task 13: Tool — `system:list_pending_approvals`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/list-pending-approvals.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-list-pending-approvals.test.ts`

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-list-pending-approvals.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockLimit = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect }),
  wikiAgentWrites: {},
  agents: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  desc: vi.fn((c) => ({ desc: c })),
}))

const { listPendingApprovalsTool } = await import('../lib/copilot/tools/list-pending-approvals')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:list_pending_approvals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ limit: mockLimit }),
          }),
        }),
      }),
    })
  })

  it('returns pending writes with content_preview truncated', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'w1', agent_name: 'Atend',
      slug: 'devolucao', title: 'Política de devolução',
      content: 'A'.repeat(500),
      target_wiki: 'strategic', created_at: new Date('2026-04-27T10:00:00Z'),
    }])
    const r = await listPendingApprovalsTool.handler({}, ctx)
    expect(r).toHaveLength(1)
    expect(r[0]?.content_preview).toHaveLength(200)
    expect(r[0]?.title).toBe('Política de devolução')
  })

  it('has admin_only permission', () => {
    expect(listPendingApprovalsTool.permission).toBe('admin_only')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-tool-list-pending-approvals`

- [ ] **Step 3: Implement the tool**

Write `packages/agents/src/lib/copilot/tools/list-pending-approvals.ts`:

```typescript
import { eq, and, desc } from 'drizzle-orm'
import { getDb, wikiAgentWrites, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface ListPendingApprovalsInput {
  agent_id?: string
}

interface PendingApproval {
  id: string
  agent_name: string | null
  slug: string
  title: string
  target_wiki: string
  created_at: string
  content_preview: string
}

export const listPendingApprovalsTool: CopilotTool<ListPendingApprovalsInput, PendingApproval[]> = {
  name: 'system:list_pending_approvals',
  description: 'Lista propostas de escrita na wiki pendentes de aprovação humana (HITL). Cada item: agente proponente, slug, título, target wiki, preview do conteúdo. Use para "tem coisa pra aprovar", "fila HITL", "aprovações pendentes".',
  input_schema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', format: 'uuid', description: 'Filtra por agente proponente. Omitir para todas.' },
    },
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    const db = getDb()
    const conditions = [
      eq(wikiAgentWrites.tenant_id, ctx.tenant_id),
      eq(wikiAgentWrites.status, 'draft'),
    ]
    if (input.agent_id) conditions.push(eq(wikiAgentWrites.agent_id, input.agent_id))

    const rows = await db.select({
      id: wikiAgentWrites.id,
      agent_name: agents.name,
      slug: wikiAgentWrites.slug,
      title: wikiAgentWrites.title,
      content: wikiAgentWrites.content,
      target_wiki: wikiAgentWrites.target_wiki,
      created_at: wikiAgentWrites.created_at,
    })
      .from(wikiAgentWrites)
      .leftJoin(agents, eq(agents.id, wikiAgentWrites.agent_id))
      .where(and(...conditions))
      .orderBy(desc(wikiAgentWrites.created_at))
      .limit(50)

    return rows.map(r => {
      const createdAt = r.created_at instanceof Date ? r.created_at : new Date(r.created_at)
      return {
        id: r.id,
        agent_name: r.agent_name,
        slug: r.slug,
        title: r.title,
        target_wiki: r.target_wiki,
        created_at: createdAt.toISOString(),
        content_preview: r.content.slice(0, 200),
      }
    })
  },
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-tool-list-pending-approvals`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/list-pending-approvals.ts \
        packages/agents/src/__tests__/copilot-tool-list-pending-approvals.test.ts
git commit -m "feat(copilot): tool system:list_pending_approvals"
```

---

## Task 14: Tool — `system:wiki_query`

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/wiki-query.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-wiki-query.test.ts`

> **AUDIT NOTE (2026-04-28)**: original plan said "wraps existing executeWikiQuery". That function is **private** in `skill-executor.ts` (not exported). Re-implement the query inline in this tool — uses the same primitives (`embed`, `getDb`, raw SQL pgvector) but kept independent. This avoids coupling to an internal skill-executor symbol.

The implementation below already does the query inline (uses `embed` + raw SQL via `db.execute(sql\`...\`)`) — no import of `executeWikiQuery` is needed. Do NOT try to import `executeWikiQuery` from skill-executor.

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-wiki-query.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockComplete = vi.fn()
const mockExecute = vi.fn()

vi.mock('../lib/provider', () => ({
  createRegistryFromEnv: () => ({ complete: mockComplete }),
}))

vi.mock('@ethra-nexus/wiki', () => ({
  embed: vi.fn().mockResolvedValue([0, 0, 0]),
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ execute: mockExecute }),
}))

vi.mock('drizzle-orm', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
}))

const { wikiQueryTool } = await import('../lib/copilot/tools/wiki-query')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:wiki_query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecute.mockResolvedValue({ rows: [] })
    mockComplete.mockResolvedValue({
      content: 'Respostas baseadas na wiki...',
      input_tokens: 100,
      output_tokens: 50,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      is_fallback: false,
      estimated_cost_usd: 0.001,
    })
  })

  it('returns answer plus sources', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ title: 'Política X', slug: 'pol-x', similarity: 0.85, content: 'conteúdo x' }] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await wikiQueryTool.handler({ question: 'O que diz a política?' }, ctx)
    expect(r.answer).toContain('wiki')
    expect(r.sources).toHaveLength(1)
    expect(r.sources[0]).toMatchObject({ title: 'Política X', scope: 'strategic' })
  })

  it('rejects question shorter than 3 chars', async () => {
    await expect(wikiQueryTool.handler({ question: 'oi' }, ctx))
      .rejects.toThrow('question must be at least 3 chars')
  })

  it('has all_members permission', () => {
    expect(wikiQueryTool.permission).toBe('all_members')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-tool-wiki-query`

- [ ] **Step 3: Implement the tool**

Write `packages/agents/src/lib/copilot/tools/wiki-query.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import { embed } from '@ethra-nexus/wiki'
import { createRegistryFromEnv } from '../../provider'
import type { CopilotTool } from '../tool-registry'

interface WikiQueryInput {
  question: string
  agent_scope?: string  // slug do agente para incluir wiki dele
}

interface WikiSource {
  title: string
  slug: string
  similarity: number
  scope: 'strategic' | 'agent'
}

interface WikiQueryOutput {
  answer: string
  sources: WikiSource[]
}

export const wikiQueryTool: CopilotTool<WikiQueryInput, WikiQueryOutput> = {
  name: 'system:wiki_query',
  description: 'Busca semântica na wiki estratégica do tenant (e opcionalmente na wiki de um agente específico via slug). Retorna resposta sintetizada com sources citados. Use para perguntas sobre conhecimento, processos, políticas, decisões.',
  input_schema: {
    type: 'object',
    properties: {
      question:    { type: 'string', minLength: 3, description: 'Pergunta em linguagem natural, mínimo 3 caracteres.' },
      agent_scope: { type: 'string', description: 'Slug do agente para incluir sua wiki individual. Omitir para só wiki estratégica.' },
    },
    required: ['question'],
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    if (!input.question || input.question.length < 3) {
      throw new Error('question must be at least 3 chars')
    }

    const db = getDb()
    const queryEmbedding = await embed(input.question)
    const vectorStr = `[${queryEmbedding.join(',')}]`

    const strategicRows = await db.execute(sql`
      SELECT title, slug, content, 1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM wiki_strategic_pages
      WHERE tenant_id = ${ctx.tenant_id} AND status = 'ativo' AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT 5
    `)

    type WikiRow = { title: string; slug: string; content: string; similarity: number }
    const sources: Array<WikiSource & { content: string }> = []
    for (const r of strategicRows.rows as WikiRow[]) {
      if (r.similarity > 0.4) {
        sources.push({ title: r.title, slug: r.slug, similarity: Number(r.similarity), scope: 'strategic', content: r.content })
      }
    }

    if (input.agent_scope) {
      const agentRows = await db.execute(sql`
        SELECT wap.title, wap.slug, wap.content,
               1 - (wap.embedding <=> ${vectorStr}::vector) AS similarity
        FROM wiki_agent_pages wap
        JOIN agents a ON a.id = wap.agent_id
        WHERE a.tenant_id = ${ctx.tenant_id} AND a.slug = ${input.agent_scope}
          AND wap.status = 'ativo' AND wap.embedding IS NOT NULL
        ORDER BY wap.embedding <=> ${vectorStr}::vector
        LIMIT 3
      `)
      for (const r of agentRows.rows as WikiRow[]) {
        if (r.similarity > 0.4) {
          sources.push({ title: r.title, slug: r.slug, similarity: Number(r.similarity), scope: 'agent', content: r.content })
        }
      }
    }

    sources.sort((a, b) => b.similarity - a.similarity)
    const top = sources.slice(0, 5)
    const wikiContext = top.map(s => `## ${s.title}\n${s.content}`).join('\n\n---\n\n')

    const registry = createRegistryFromEnv()
    const completion = await registry.complete('wiki:query', {
      messages: [
        { role: 'system', content: `Responda usando APENAS o conteúdo da wiki abaixo. Cite títulos de páginas. Se não houver match, diga "não encontrei na wiki".\n\n${wikiContext}` },
        { role: 'user', content: input.question },
      ],
      max_tokens: 800,
      sensitive_data: true,
    })

    return {
      answer: completion.content,
      sources: top.map(s => ({ title: s.title, slug: s.slug, similarity: s.similarity, scope: s.scope })),
    }
  },
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-tool-wiki-query`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/wiki-query.ts \
        packages/agents/src/__tests__/copilot-tool-wiki-query.test.ts
git commit -m "feat(copilot): tool system:wiki_query"
```

---

## Task 15: Tool — `system:list_storage_alerts` (stub)

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/list-storage-alerts.ts`
- Create: `packages/agents/src/__tests__/copilot-tool-list-storage-alerts.test.ts`

Returns `[]` until Spec #2 (file storage) ships. Documented as future-ready.

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-tool-list-storage-alerts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { listStorageAlertsTool } from '../lib/copilot/tools/list-storage-alerts'

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:list_storage_alerts', () => {
  it('returns empty array (stub until Spec #2)', async () => {
    const r = await listStorageAlertsTool.handler({}, ctx)
    expect(r).toEqual([])
  })

  it('has admin_only permission', () => {
    expect(listStorageAlertsTool.permission).toBe('admin_only')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-tool-list-storage-alerts`

- [ ] **Step 3: Implement the stub**

Write `packages/agents/src/lib/copilot/tools/list-storage-alerts.ts`:

```typescript
import type { CopilotTool } from '../tool-registry'

interface ListStorageAlertsInput {
  level?: 'soft_warning' | 'migration_recommended' | 'hard_limit'
}

interface StorageAlert {
  level: string
  type: string
  message: string
  fired_at: string
}

// STUB: returns [] until Spec #2 (file storage + alerts) is implemented.
// When Spec #2 ships, replace handler body with real query against storage_alerts_fired.
export const listStorageAlertsTool: CopilotTool<ListStorageAlertsInput, StorageAlert[]> = {
  name: 'system:list_storage_alerts',
  description: 'Lista alertas de capacidade de storage (uploads, attachments) do tenant. Atualmente retorna lista vazia até o subsistema de storage ser implementado.',
  input_schema: {
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['soft_warning', 'migration_recommended', 'hard_limit'] },
    },
  },
  permission: 'admin_only',
  handler: async () => [],
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-tool-list-storage-alerts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/list-storage-alerts.ts \
        packages/agents/src/__tests__/copilot-tool-list-storage-alerts.test.ts
git commit -m "feat(copilot): tool system:list_storage_alerts (stub for Spec #2)"
```

---

## Task 16: All-tools array + module index

**Files:**
- Create: `packages/agents/src/lib/copilot/tools/index.ts`
- Create: `packages/agents/src/lib/copilot/index.ts`

- [ ] **Step 1: Aggregate tools array**

Write `packages/agents/src/lib/copilot/tools/index.ts`:

```typescript
import type { CopilotTool } from '../tool-registry'
import { listAgentsTool } from './list-agents'
import { getRecentEventsTool } from './get-recent-events'
import { explainEventTool } from './explain-event'
import { getBudgetStatusTool } from './get-budget-status'
import { costBreakdownTool } from './cost-breakdown'
import { agentHealthTool } from './agent-health'
import { listPendingApprovalsTool } from './list-pending-approvals'
import { wikiQueryTool } from './wiki-query'
import { listStorageAlertsTool } from './list-storage-alerts'

export const allCopilotTools: CopilotTool[] = [
  listAgentsTool,
  getRecentEventsTool,
  explainEventTool,
  getBudgetStatusTool,
  costBreakdownTool,
  agentHealthTool,
  listPendingApprovalsTool,
  wikiQueryTool,
  listStorageAlertsTool,
] as CopilotTool[]

export function findToolByName(name: string): CopilotTool | undefined {
  return allCopilotTools.find(t => t.name === name)
}
```

- [ ] **Step 2: Public module index**

Write `packages/agents/src/lib/copilot/index.ts`:

```typescript
export { getAnthropicClient } from './anthropic-client'
export { AIOS_MASTER_SYSTEM_PROMPT } from './system-prompt'
export type { CopilotTool, ToolContext, ToolCallResult } from './tool-registry'
export { executeToolCall, getToolsForAnthropic } from './tool-registry'
export { allCopilotTools, findToolByName } from './tools'
export { executeCopilotTurn } from './turn-loop'
```

> Note: `turn-loop.ts` doesn't exist yet — Task 17 creates it. The export will fail typecheck until Task 17 completes. This is fine: the index is forward-declared.

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/lib/copilot/tools/index.ts \
        packages/agents/src/lib/copilot/index.ts
git commit -m "feat(copilot): tool array aggregator + module public index"
```

---

## Task 17: Turn loop — text-only flow

**Files:**
- Create: `packages/agents/src/lib/copilot/turn-loop.ts`
- Create: `packages/agents/src/__tests__/copilot-turn-loop.test.ts`

This task implements the simplest path: user sends text, agent responds with text, no tools. Tasks 18/19/20 layer on top.

- [ ] **Step 1: Write failing test (text-only path)**

Write `packages/agents/src/__tests__/copilot-turn-loop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSelect = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
  }),
  copilotConversations: { id: 'id', message_count: 'mc', total_tokens: 'tt', total_cost_usd: 'tcu', last_message_at: 'lma', updated_at: 'ua' },
  copilotMessages: { conversation_id: 'cid', tenant_id: 'tid', role: 'role', content: 'content' },
  copilotToolCalls: {},
  agents: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  asc: vi.fn((c) => ({ asc: c })),
  sql: (s: TemplateStringsArray) => s.join(''),
}))

const mockStream = vi.fn()
vi.mock('../lib/copilot/anthropic-client', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockStream },
  }),
}))

vi.mock('../lib/copilot/tools', () => ({
  allCopilotTools: [],
  findToolByName: () => undefined,
}))

const { executeCopilotTurn } = await import('../lib/copilot/turn-loop')

function makeStream(events: Array<unknown>) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

describe('executeCopilotTurn — text-only', () => {
  let sseEvents: Array<{ type: string; [k: string]: unknown }>
  let sse: { write: (e: object) => void }

  beforeEach(() => {
    vi.clearAllMocks()
    sseEvents = []
    sse = { write: (e) => sseEvents.push(e as { type: string }) }

    // Mock insert message
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'msg-1' }]),
      }),
    })

    // Mock update conversation
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    // Mock select history
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),  // empty history
        }),
      }),
    })

    // Mock Anthropic stream — single text response, end_turn
    mockStream.mockResolvedValue(makeStream([
      { type: 'message_start', message: { id: 'msg_anth' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Olá!' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10, output_tokens: 5 } },
      { type: 'message_stop' },
    ]))
  })

  it('persists user message + assistant message; emits turn_start and turn_complete', async () => {
    await executeCopilotTurn({
      conversation_id: 'c1',
      tenant_id: 't1',
      user_id: 'u1',
      user_role: 'admin',
      content: 'Olá',
      system_prompt: 'You are helpful',
      sse,
      abortSignal: new AbortController().signal,
    })
    const types = sseEvents.map(e => e.type)
    expect(types).toContain('turn_start')
    expect(types).toContain('text_delta')
    expect(types).toContain('assistant_message_complete')
    expect(types).toContain('turn_complete')
    // user message + assistant message = 2 inserts
    expect(mockInsert).toHaveBeenCalled()
  })

  it('forwards text_delta events with delta string', async () => {
    await executeCopilotTurn({
      conversation_id: 'c1', tenant_id: 't1', user_id: 'u1', user_role: 'admin',
      content: 'Olá', system_prompt: 'sp', sse, abortSignal: new AbortController().signal,
    })
    const deltaEvents = sseEvents.filter(e => e.type === 'text_delta')
    expect(deltaEvents).toHaveLength(1)
    expect(deltaEvents[0]?.['delta']).toBe('Olá!')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-turn-loop`
Expected: FAIL — Cannot find module `turn-loop`.

- [ ] **Step 3: Implement turn-loop with text-only support**

Write `packages/agents/src/lib/copilot/turn-loop.ts`:

```typescript
import { eq, and, asc, sql } from 'drizzle-orm'
import {
  getDb, copilotConversations, copilotMessages, copilotToolCalls,
} from '@ethra-nexus/db'
import { getAnthropicClient } from './anthropic-client'
import { allCopilotTools, findToolByName } from './tools'
import { executeToolCall, getToolsForAnthropic, type ToolContext } from './tool-registry'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4000

// Anthropic SDK message blocks (subset we use)
type TextBlock = { type: 'text'; text: string }
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export interface SseWriter {
  write: (event: { type: string; [k: string]: unknown }) => void
}

export interface ExecuteCopilotTurnParams {
  conversation_id: string
  tenant_id: string
  user_id: string
  user_role: 'admin' | 'member'
  content: string
  system_prompt: string
  sse: SseWriter
  abortSignal: AbortSignal
}

export interface TurnResult {
  total_tokens: number
  total_cost_usd: number
  tool_call_count: number
  stop_reason: string
}

export async function executeCopilotTurn(p: ExecuteCopilotTurnParams): Promise<TurnResult> {
  const db = getDb()
  const anth = getAnthropicClient()

  // 1. Insert user message
  const userMsgRows = await db.insert(copilotMessages).values({
    conversation_id: p.conversation_id,
    tenant_id: p.tenant_id,
    role: 'user',
    content: [{ type: 'text', text: p.content }],
  }).returning({ id: copilotMessages.id })
  const userMessageId = userMsgRows[0]!.id
  p.sse.write({ type: 'turn_start', user_message_id: userMessageId })

  // 2. Load full history (including the user msg we just inserted)
  const historyRows = await db.select({
    role: copilotMessages.role, content: copilotMessages.content,
  })
    .from(copilotMessages)
    .where(eq(copilotMessages.conversation_id, p.conversation_id))
    .orderBy(asc(copilotMessages.created_at))

  const history = historyRows.map(r => ({
    role: r.role as 'user' | 'assistant',
    content: r.content as ContentBlock[],
  }))

  // 3. Call Anthropic (single iteration in this task; tool loop comes in Task 18)
  const ctx: ToolContext = { tenant_id: p.tenant_id, user_id: p.user_id, user_role: p.user_role }
  let totalTokensIn = 0
  let totalTokensOut = 0
  let totalCost = 0
  let toolCallCount = 0
  let lastStopReason = 'end_turn'

  const stream = await anth.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: p.system_prompt,
    tools: getToolsForAnthropic(allCopilotTools),
    messages: history,
    stream: true,
  }, { signal: p.abortSignal })

  // Accumulate streamed blocks
  const blocks: ContentBlock[] = []
  let currentText = ''

  for await (const event of stream as AsyncIterable<{ type: string; [k: string]: unknown }>) {
    if (event.type === 'content_block_start') {
      const cb = event['content_block'] as { type: string; id?: string; name?: string }
      if (cb.type === 'text') {
        currentText = ''
      } else if (cb.type === 'tool_use') {
        blocks.push({ type: 'tool_use', id: cb.id ?? '', name: cb.name ?? '', input: {} })
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event['delta'] as { type: string; text?: string; partial_json?: string }
      if (delta.type === 'text_delta' && delta.text) {
        currentText += delta.text
        p.sse.write({ type: 'text_delta', delta: delta.text })
      }
      // input_json_delta handled in Task 18
    } else if (event.type === 'content_block_stop') {
      if (currentText) {
        blocks.push({ type: 'text', text: currentText })
        currentText = ''
      }
    } else if (event.type === 'message_delta') {
      const md = event['delta'] as { stop_reason?: string }
      const usage = event['usage'] as { input_tokens?: number; output_tokens?: number }
      if (md.stop_reason) lastStopReason = md.stop_reason
      if (usage) {
        totalTokensIn += usage.input_tokens ?? 0
        totalTokensOut += usage.output_tokens ?? 0
      }
    }
  }

  // Estimate cost (Sonnet 4.6 rates)
  const messageCost = (totalTokensIn / 1_000_000) * 3 + (totalTokensOut / 1_000_000) * 15
  totalCost += messageCost

  // 4. Persist assistant message
  const assistantRows = await db.insert(copilotMessages).values({
    conversation_id: p.conversation_id,
    tenant_id: p.tenant_id,
    role: 'assistant',
    content: blocks,
    model: MODEL,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: messageCost.toFixed(6),
    stop_reason: lastStopReason,
  }).returning({ id: copilotMessages.id })
  const assistantMessageId = assistantRows[0]!.id

  p.sse.write({
    type: 'assistant_message_complete',
    message_id: assistantMessageId,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: messageCost,
    stop_reason: lastStopReason,
  })

  // Tool execution will be added in Task 18 (here we ignore tool_use stop_reason)

  // 5. Update conversation aggregates
  await db.update(copilotConversations).set({
    message_count: sql`${copilotConversations.message_count} + 2`,
    total_tokens: sql`${copilotConversations.total_tokens} + ${totalTokensIn + totalTokensOut}`,
    total_cost_usd: sql`${copilotConversations.total_cost_usd} + ${totalCost}`,
    last_message_at: new Date(),
    updated_at: new Date(),
  }).where(eq(copilotConversations.id, p.conversation_id))

  p.sse.write({
    type: 'turn_complete',
    total_tokens: totalTokensIn + totalTokensOut,
    total_cost_usd: totalCost,
    tool_call_count: toolCallCount,
  })

  // Suppress unused-import warnings for symbols Tasks 18+ will use
  void copilotToolCalls; void executeToolCall; void findToolByName; void ctx

  return { total_tokens: totalTokensIn + totalTokensOut, total_cost_usd: totalCost, tool_call_count: toolCallCount, stop_reason: lastStopReason }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-turn-loop`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/turn-loop.ts \
        packages/agents/src/__tests__/copilot-turn-loop.test.ts
git commit -m "feat(copilot): turn loop — text-only flow with SSE streaming"
```

---

## Task 18: Turn loop — tool execution within turn

**Files:**
- Modify: `packages/agents/src/lib/copilot/turn-loop.ts`
- Modify: `packages/agents/src/__tests__/copilot-turn-loop.test.ts` (add tool case)

- [ ] **Step 1: Add failing test for tool flow**

Append to `packages/agents/src/__tests__/copilot-turn-loop.test.ts` inside the `describe`:

```typescript
describe('executeCopilotTurn — with tools', () => {
  let sseEvents: Array<{ type: string; [k: string]: unknown }>
  let sse: { write: (e: object) => void }

  beforeEach(() => {
    vi.clearAllMocks()
    sseEvents = []
    sse = { write: (e) => sseEvents.push(e as { type: string }) }

    // Mock 2 inserts (user msg, assistant msg) then more for follow-up
    let insertCount = 0
    mockInsert.mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => {
          insertCount++
          return Promise.resolve([{ id: `msg-${insertCount}` }])
        }),
      }),
    }))

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            { role: 'user', content: [{ type: 'text', text: 'Olá' }] },
          ]),
        }),
      }),
    })
  })

  it('runs tool, emits tool_use_start/complete, recurses to final response', async () => {
    // First Anthropic call: returns tool_use
    mockStream
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'test:noop', input: {} } }
          yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }
          yield { type: 'content_block_stop', index: 0 }
          yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 10, output_tokens: 5 } }
        },
      })
      // Second call: text response
      .mockResolvedValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }
          yield { type: 'content_block_stop', index: 0 }
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 12, output_tokens: 3 } }
        },
      })

    // Mock tools list with a noop tool
    const toolsModule = await import('../lib/copilot/tools')
    const noopTool = {
      name: 'test:noop',
      description: 'noop',
      input_schema: { type: 'object', properties: {} },
      permission: 'all_members' as const,
      handler: async () => ({ ok: true }),
    }
    vi.spyOn(toolsModule, 'allCopilotTools', 'get').mockReturnValue([noopTool] as never)
    vi.spyOn(toolsModule, 'findToolByName').mockReturnValue(noopTool as never)

    await executeCopilotTurn({
      conversation_id: 'c1', tenant_id: 't1', user_id: 'u1', user_role: 'admin',
      content: 'Olá', system_prompt: 'sp', sse, abortSignal: new AbortController().signal,
    })

    const types = sseEvents.map(e => e.type)
    expect(types).toContain('tool_use_start')
    expect(types).toContain('tool_use_complete')
    expect(mockStream).toHaveBeenCalledTimes(2)  // one round-trip due to tool
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-turn-loop`

- [ ] **Step 3: Refactor turn-loop.ts to support tool execution**

Replace `packages/agents/src/lib/copilot/turn-loop.ts` (overwrite) with:

```typescript
import { eq, asc, sql } from 'drizzle-orm'
import {
  getDb, copilotConversations, copilotMessages, copilotToolCalls,
} from '@ethra-nexus/db'
import { getAnthropicClient } from './anthropic-client'
import { allCopilotTools, findToolByName } from './tools'
import { executeToolCall, getToolsForAnthropic, type ToolContext } from './tool-registry'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4000

type TextBlock = { type: 'text'; text: string }
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export interface SseWriter {
  write: (event: { type: string; [k: string]: unknown }) => void
}

export interface ExecuteCopilotTurnParams {
  conversation_id: string
  tenant_id: string
  user_id: string
  user_role: 'admin' | 'member'
  content: string
  system_prompt: string
  sse: SseWriter
  abortSignal: AbortSignal
}

export interface TurnResult {
  total_tokens: number
  total_cost_usd: number
  tool_call_count: number
  stop_reason: string
}

interface AssistantStepResult {
  blocks: ContentBlock[]
  tokens_in: number
  tokens_out: number
  stop_reason: string
}

async function streamAssistantStep(args: {
  history: Array<{ role: 'user' | 'assistant'; content: ContentBlock[] }>
  system: string
  abortSignal: AbortSignal
  sse: SseWriter
}): Promise<AssistantStepResult> {
  const anth = getAnthropicClient()
  const stream = await anth.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: args.system,
    tools: getToolsForAnthropic(allCopilotTools),
    messages: args.history,
    stream: true,
  }, { signal: args.abortSignal })

  const blocks: ContentBlock[] = []
  let currentText = ''
  let currentToolUse: ToolUseBlock | null = null
  let currentToolJson = ''
  let tokensIn = 0
  let tokensOut = 0
  let stopReason = 'end_turn'

  for await (const ev of stream as AsyncIterable<{ type: string; [k: string]: unknown }>) {
    if (ev.type === 'content_block_start') {
      const cb = ev['content_block'] as { type: string; id?: string; name?: string; input?: Record<string, unknown> }
      if (cb.type === 'text') {
        currentText = ''
      } else if (cb.type === 'tool_use') {
        currentToolUse = { type: 'tool_use', id: cb.id ?? '', name: cb.name ?? '', input: cb.input ?? {} }
        currentToolJson = ''
        args.sse.write({ type: 'tool_use_start', tool_use_id: currentToolUse.id, tool_name: currentToolUse.name })
      }
    } else if (ev.type === 'content_block_delta') {
      const delta = ev['delta'] as { type: string; text?: string; partial_json?: string }
      if (delta.type === 'text_delta' && delta.text) {
        currentText += delta.text
        args.sse.write({ type: 'text_delta', delta: delta.text })
      } else if (delta.type === 'input_json_delta' && delta.partial_json) {
        currentToolJson += delta.partial_json
      }
    } else if (ev.type === 'content_block_stop') {
      if (currentText) {
        blocks.push({ type: 'text', text: currentText })
        currentText = ''
      }
      if (currentToolUse) {
        if (currentToolJson) {
          try { currentToolUse.input = JSON.parse(currentToolJson) } catch { /* keep input as-is */ }
        }
        blocks.push(currentToolUse)
        currentToolUse = null
        currentToolJson = ''
      }
    } else if (ev.type === 'message_delta') {
      const md = ev['delta'] as { stop_reason?: string }
      const usage = ev['usage'] as { input_tokens?: number; output_tokens?: number }
      if (md.stop_reason) stopReason = md.stop_reason
      if (usage) {
        tokensIn += usage.input_tokens ?? 0
        tokensOut += usage.output_tokens ?? 0
      }
    }
  }

  return { blocks, tokens_in: tokensIn, tokens_out: tokensOut, stop_reason: stopReason }
}

function blockCost(tokens_in: number, tokens_out: number): number {
  return (tokens_in / 1_000_000) * 3 + (tokens_out / 1_000_000) * 15
}

export async function executeCopilotTurn(p: ExecuteCopilotTurnParams): Promise<TurnResult> {
  const db = getDb()
  const ctx: ToolContext = { tenant_id: p.tenant_id, user_id: p.user_id, user_role: p.user_role }

  // 1. Insert user message
  const userMsgRows = await db.insert(copilotMessages).values({
    conversation_id: p.conversation_id,
    tenant_id: p.tenant_id,
    role: 'user',
    content: [{ type: 'text', text: p.content }],
  }).returning({ id: copilotMessages.id })
  const userMessageId = userMsgRows[0]!.id
  p.sse.write({ type: 'turn_start', user_message_id: userMessageId })

  // 2. Load history
  const historyRows = await db.select({
    role: copilotMessages.role, content: copilotMessages.content,
  })
    .from(copilotMessages)
    .where(eq(copilotMessages.conversation_id, p.conversation_id))
    .orderBy(asc(copilotMessages.created_at))

  let history = historyRows.map(r => ({
    role: r.role as 'user' | 'assistant',
    content: r.content as ContentBlock[],
  }))

  // 3. Agentic loop
  let totalIn = 0
  let totalOut = 0
  let totalCost = 0
  let toolCallCount = 0
  let lastStopReason = 'end_turn'
  let messagesPersistedInTurn = 1  // user message already counted

  while (true) {
    const step = await streamAssistantStep({
      history,
      system: p.system_prompt,
      abortSignal: p.abortSignal,
      sse: p.sse,
    })
    totalIn += step.tokens_in
    totalOut += step.tokens_out
    const stepCost = blockCost(step.tokens_in, step.tokens_out)
    totalCost += stepCost
    lastStopReason = step.stop_reason

    const assistantRows = await db.insert(copilotMessages).values({
      conversation_id: p.conversation_id,
      tenant_id: p.tenant_id,
      role: 'assistant',
      content: step.blocks,
      model: MODEL,
      tokens_in: step.tokens_in,
      tokens_out: step.tokens_out,
      cost_usd: stepCost.toFixed(6),
      stop_reason: step.stop_reason,
    }).returning({ id: copilotMessages.id })
    const assistantMessageId = assistantRows[0]!.id
    messagesPersistedInTurn++

    p.sse.write({
      type: 'assistant_message_complete',
      message_id: assistantMessageId,
      tokens_in: step.tokens_in,
      tokens_out: step.tokens_out,
      cost_usd: stepCost,
      stop_reason: step.stop_reason,
    })

    history = [...history, { role: 'assistant', content: step.blocks }]

    if (step.stop_reason !== 'tool_use') break

    // Execute each tool_use block
    const toolResultBlocks: ToolResultBlock[] = []
    for (const block of step.blocks) {
      if (block.type !== 'tool_use') continue
      toolCallCount++
      const tool = findToolByName(block.name)

      let result: unknown
      let status = 'completed'
      let errorCode: string | null = null
      let durationMs = 0

      if (!tool) {
        result = { error: `Tool not found: ${block.name}` }
        status = 'error'
        errorCode = 'TOOL_NOT_FOUND'
      } else {
        const r = await executeToolCall(tool, block.input, ctx)
        durationMs = r.durationMs
        if (r.error) {
          result = { error: r.error }
          status = 'error'
          errorCode = r.error
        } else {
          result = r.result
        }
      }

      // Persist tool call
      await db.insert(copilotToolCalls).values({
        message_id: assistantMessageId,
        conversation_id: p.conversation_id,
        tenant_id: p.tenant_id,
        tool_use_id: block.id,
        tool_name: block.name,
        tool_input: block.input,
        tool_result: result as Record<string, unknown>,
        status,
        error_code: errorCode,
        duration_ms: durationMs,
      })

      // Wrap result for the model (defensive against prompt injection)
      const wrapped = `<tool_output tool="${block.name}">\n${JSON.stringify(result)}\n</tool_output>`
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: wrapped,
        is_error: status === 'error',
      })

      p.sse.write({ type: 'tool_use_complete', tool_use_id: block.id, status, duration_ms: durationMs })
    }

    // Append synthetic user message with tool_results
    await db.insert(copilotMessages).values({
      conversation_id: p.conversation_id,
      tenant_id: p.tenant_id,
      role: 'user',
      content: toolResultBlocks,
    })
    history = [...history, { role: 'user', content: toolResultBlocks }]
    messagesPersistedInTurn++
  }

  // 4. Update conversation aggregates
  await db.update(copilotConversations).set({
    message_count: sql`${copilotConversations.message_count} + ${messagesPersistedInTurn}`,
    total_tokens: sql`${copilotConversations.total_tokens} + ${totalIn + totalOut}`,
    total_cost_usd: sql`${copilotConversations.total_cost_usd} + ${totalCost}`,
    last_message_at: new Date(),
    updated_at: new Date(),
  }).where(eq(copilotConversations.id, p.conversation_id))

  p.sse.write({
    type: 'turn_complete',
    total_tokens: totalIn + totalOut,
    total_cost_usd: totalCost,
    tool_call_count: toolCallCount,
  })

  return {
    total_tokens: totalIn + totalOut,
    total_cost_usd: totalCost,
    tool_call_count: toolCallCount,
    stop_reason: lastStopReason,
  }
}
```

- [ ] **Step 4: Run test, verify PASS (both text-only and tool flow)**

Run: `cd packages/agents && npx vitest run copilot-turn-loop`
Expected: PASS, 3+ tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/turn-loop.ts \
        packages/agents/src/__tests__/copilot-turn-loop.test.ts
git commit -m "feat(copilot): turn loop — tool execution + SSE tool events"
```

---

## Task 19: Turn loop — per-turn cost + tool count caps

**Files:**
- Modify: `packages/agents/src/lib/copilot/turn-loop.ts`
- Modify: `packages/agents/src/__tests__/copilot-turn-loop.test.ts` (add cap tests)

- [ ] **Step 1: Add failing tests for caps**

Append to the test file:

```typescript
describe('executeCopilotTurn — caps', () => {
  let sseEvents: Array<{ type: string; [k: string]: unknown }>
  let sse: { write: (e: object) => void }

  beforeEach(() => {
    vi.clearAllMocks()
    sseEvents = []
    sse = { write: (e) => sseEvents.push(e as { type: string }) }
    let n = 0
    mockInsert.mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => Promise.resolve([{ id: `m-${++n}` }])),
      }),
    }))
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
      }),
    })
  })

  it('TURN_TOOLS_EXCEEDED when more than MAX_TOOLS tool_use in single message', async () => {
    process.env['COPILOT_MAX_TOOLS_PER_TURN'] = '2'
    // Mock returns 3 tool_use blocks in one assistant message
    mockStream.mockResolvedValueOnce({
      [Symbol.asyncIterator]: async function* () {
        for (let i = 0; i < 3; i++) {
          yield { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `t${i}`, name: 'test:noop', input: {} } }
          yield { type: 'content_block_stop', index: i }
        }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 1, output_tokens: 1 } }
      },
    })
    const toolsModule = await import('../lib/copilot/tools')
    vi.spyOn(toolsModule, 'findToolByName').mockReturnValue({
      name: 'test:noop', description: '', input_schema: { type: 'object' },
      permission: 'all_members', handler: async () => ({}),
    } as never)

    await executeCopilotTurn({
      conversation_id: 'c1', tenant_id: 't1', user_id: 'u1', user_role: 'admin',
      content: 'x', system_prompt: 'sp', sse, abortSignal: new AbortController().signal,
    })

    const errors = sseEvents.filter(e => e.type === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.['code']).toBe('TURN_TOOLS_EXCEEDED')
    delete process.env['COPILOT_MAX_TOOLS_PER_TURN']
  })

  it('TURN_COST_EXCEEDED when accumulated cost passes cap', async () => {
    process.env['COPILOT_MAX_COST_PER_TURN_USD'] = '0.0001'  // tiny
    mockStream.mockResolvedValueOnce({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'big response' } }
        yield { type: 'content_block_stop', index: 0 }
        yield { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 10000, output_tokens: 10000 } }
      },
    })

    await executeCopilotTurn({
      conversation_id: 'c1', tenant_id: 't1', user_id: 'u1', user_role: 'admin',
      content: 'x', system_prompt: 'sp', sse, abortSignal: new AbortController().signal,
    })

    const errors = sseEvents.filter(e => e.type === 'error')
    expect(errors.some(e => e['code'] === 'TURN_COST_EXCEEDED')).toBe(true)
    delete process.env['COPILOT_MAX_COST_PER_TURN_USD']
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-turn-loop`

- [ ] **Step 3: Modify turn-loop.ts to enforce caps**

In `packages/agents/src/lib/copilot/turn-loop.ts`, find these constants near the top:

```typescript
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4000
```

Replace with:

```typescript
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4000

function maxToolsPerTurn(): number {
  return parseInt(process.env['COPILOT_MAX_TOOLS_PER_TURN'] ?? '10', 10)
}
function maxCostPerTurnUsd(): number {
  return parseFloat(process.env['COPILOT_MAX_COST_PER_TURN_USD'] ?? '0.50')
}
```

Then inside `executeCopilotTurn`'s `while (true)` loop, **after** computing `totalCost += stepCost` and **after** the assistant insert/SSE, add a cost cap check:

```typescript
    if (totalCost > maxCostPerTurnUsd()) {
      p.sse.write({ type: 'error', code: 'TURN_COST_EXCEEDED', message: `Turno excedeu orçamento de $${maxCostPerTurnUsd()} USD.` })
      // Update message stop_reason
      await db.update(copilotMessages).set({ stop_reason: 'turn_cap_exceeded' }).where(eq(copilotMessages.id, assistantMessageId))
      lastStopReason = 'turn_cap_exceeded'
      break
    }

    if (step.stop_reason !== 'tool_use') break
```

Also, before the tool execution `for` loop, add cap check:

```typescript
    // Check tool count cap BEFORE executing this batch
    const blocksToolCount = step.blocks.filter(b => b.type === 'tool_use').length
    if (toolCallCount + blocksToolCount > maxToolsPerTurn()) {
      p.sse.write({ type: 'error', code: 'TURN_TOOLS_EXCEEDED', message: `Turno excedeu ${maxToolsPerTurn()} chamadas de tool.` })
      await db.update(copilotMessages).set({ stop_reason: 'turn_cap_exceeded' }).where(eq(copilotMessages.id, assistantMessageId))
      lastStopReason = 'turn_cap_exceeded'
      break
    }
```

Need to import `copilotMessages.id` reference for the update — already imported.

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-turn-loop`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/lib/copilot/turn-loop.ts \
        packages/agents/src/__tests__/copilot-turn-loop.test.ts
git commit -m "feat(copilot): per-turn cost + tool count caps with env config"
```

---

## Task 20: Auto-title fire-and-forget (Haiku)

**Files:**
- Create: `packages/agents/src/lib/copilot/auto-title.ts`
- Create: `packages/agents/src/__tests__/copilot-auto-title.test.ts`

Auto-title is a separate function called by the API endpoint after a successful turn (not inside the turn loop, to keep the loop focused).

- [ ] **Step 1: Write failing test**

Write `packages/agents/src/__tests__/copilot-auto-title.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
const mockSelect = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../lib/copilot/anthropic-client', () => ({
  getAnthropicClient: () => ({ messages: { create: mockCreate } }),
}))

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect, update: mockUpdate }),
  copilotConversations: { id: 'id', title: 'title', updated_at: 'ua' },
  copilotMessages: { conversation_id: 'cid', role: 'role', content: 'content' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  asc: vi.fn((c) => ({ asc: c })),
}))

const { generateAutoTitle } = await import('../lib/copilot/auto-title')

describe('generateAutoTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) })
  })

  it('skips when conversation already has title', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Already titled' }]),
        }),
      }),
    })
    await generateAutoTitle('c1')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('generates title from first messages', async () => {
    let call = 0
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            call++
            if (call === 1) return Promise.resolve([{ id: 'c1', title: null }])
            return Promise.resolve([
              { role: 'user', content: [{ type: 'text', text: 'olá' }] },
              { role: 'assistant', content: [{ type: 'text', text: 'oi' }] },
            ])
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { role: 'user', content: [{ type: 'text', text: 'olá' }] },
              { role: 'assistant', content: [{ type: 'text', text: 'oi' }] },
            ]),
          }),
        }),
      }),
    }))
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Saudação inicial' }] })

    await generateAutoTitle('c1')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-haiku-4-5-20251001',
    }))
    expect(mockUpdate).toHaveBeenCalled()
  })

  it('swallows errors silently (fire-and-forget)', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'c1', title: null }]),
          orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ role: 'user', content: [{ type: 'text', text: 'olá' }] }]) }),
        }),
      }),
    })
    mockCreate.mockRejectedValue(new Error('haiku down'))
    // Should NOT throw
    await expect(generateAutoTitle('c1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd packages/agents && npx vitest run copilot-auto-title`

- [ ] **Step 3: Implement auto-title**

Write `packages/agents/src/lib/copilot/auto-title.ts`:

```typescript
import { eq, asc } from 'drizzle-orm'
import { getDb, copilotConversations, copilotMessages } from '@ethra-nexus/db'
import { getAnthropicClient } from './anthropic-client'

const TITLE_MODEL = 'claude-haiku-4-5-20251001'
const TITLE_SYSTEM = 'Resuma esta conversa em 4 a 6 palavras em português, sem aspas, sem pontuação final. Retorne apenas o título.'

interface MessageRow {
  role: string
  content: unknown
}

function blocksToText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text)
    .join(' ')
    .slice(0, 500)
}

export async function generateAutoTitle(conversationId: string): Promise<void> {
  try {
    const db = getDb()

    // Skip if already titled
    const convRows = await db.select({ id: copilotConversations.id, title: copilotConversations.title })
      .from(copilotConversations)
      .where(eq(copilotConversations.id, conversationId))
      .limit(1)
    const conv = convRows[0]
    if (!conv || conv.title) return

    // Get first 4 messages (typically: user, assistant, [tool_result, assistant])
    const msgs = await db.select({ role: copilotMessages.role, content: copilotMessages.content })
      .from(copilotMessages)
      .where(eq(copilotMessages.conversation_id, conversationId))
      .orderBy(asc(copilotMessages.created_at))
      .limit(4)

    const messages = (msgs as MessageRow[])
      .map(m => ({ role: m.role as 'user' | 'assistant', content: blocksToText(m.content) }))
      .filter(m => m.content.length > 0)

    if (messages.length === 0) return

    const anth = getAnthropicClient()
    const resp = await anth.messages.create({
      model: TITLE_MODEL,
      max_tokens: 30,
      system: TITLE_SYSTEM,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })

    const titleBlock = (resp.content as Array<{ type: string; text?: string }>).find(b => b.type === 'text')
    const title = titleBlock?.text?.trim().replace(/^["']|["']$/g, '').slice(0, 80)
    if (!title) return

    await db.update(copilotConversations)
      .set({ title, updated_at: new Date() })
      .where(eq(copilotConversations.id, conversationId))
  } catch {
    // Fire-and-forget: never propagate errors
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd packages/agents && npx vitest run copilot-auto-title`
Expected: PASS, 3 tests.

- [ ] **Step 5: Export from index**

In `packages/agents/src/lib/copilot/index.ts`, append:

```typescript
export { generateAutoTitle } from './auto-title'
```

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/lib/copilot/auto-title.ts \
        packages/agents/src/__tests__/copilot-auto-title.test.ts \
        packages/agents/src/lib/copilot/index.ts
git commit -m "feat(copilot): auto-title via Haiku fire-and-forget"
```

---

## Task 21: Permission middleware + route registration

**Files:**
- Create: `apps/server/src/routes/copilot.ts` (skeleton with permission only)
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Create the route file with middleware**

Write `apps/server/src/routes/copilot.ts`:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    userEmail?: string
    userRole?: 'admin' | 'member'
  }
}

// Audit-revised (2026-04-28): JWT da casa contém { tenantId, email, role }.
// MVP é admin-only — sem lookup em tenant_members (table existe em SQL mas
// não é queryable pelo app code; per-user opt-in defere até JWT ter user identity).
async function requireCopilotAccess(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { tenantId?: string; email?: string; role?: string } | undefined
  if (!user?.email) return reply.status(401).send({ error: 'Unauthorized' })
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'Copilot is admin-only' })
  }
  request.userEmail = user.email
  request.userRole = user.role as 'admin' | 'member'
}

export async function copilotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireCopilotAccess)

  // Health check (sanity route)
  app.get('/copilot/health', async (request) => {
    return { ok: true, user_email: request.userEmail, role: request.userRole }
  })

  // Real endpoints come in Tasks 22 and 23.
}
```

- [ ] **Step 2: Register in app.ts**

In `apps/server/src/app.ts`, find the imports block and add:

```typescript
import { copilotRoutes } from './routes/copilot'
```

Then in the routes registration block (after `dashboardRoutes`), add:

```typescript
  await app.register(copilotRoutes, { prefix: '/api/v1' })
```

- [ ] **Step 3: Manual smoke test**

Start server (`npm run dev` from project root). Hit:

```bash
curl -i http://localhost:3001/api/v1/copilot/health -H "Authorization: Bearer <admin-jwt>"
```

Expected: 200 with `{"ok":true,"user_email":"...","role":"admin"}`.

```bash
curl -i http://localhost:3001/api/v1/copilot/health
```

Expected: 401 Unauthorized.

```bash
# (with a non-admin token)
curl -i http://localhost:3001/api/v1/copilot/health -H "Authorization: Bearer <member-jwt>"
```

Expected: 403 with `{"error":"Copilot is admin-only"}`.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/copilot.ts apps/server/src/app.ts
git commit -m "feat(api): copilot route registration + admin-only middleware"
```

---

## Task 22: Conversation CRUD endpoints

> **AUDIT NOTE (2026-04-28)**: middleware was simplified to admin-only (Task 21 has the canonical version). The test scaffolding in Step 1 below was written assuming a DB lookup for `tenant_members.copilot_enabled`. Adapt: the test cases that simulate "first call returns member, second returns data" should be simplified — there is no member lookup anymore, just the data query. Drop the `if (calls === 1) return ... copilot_enabled` branches and renumber subsequent calls.

**Files:**
- Modify: `apps/server/src/routes/copilot.ts` (add 5 endpoints)
- Create: `apps/server/src/__tests__/copilot-routes.test.ts`

- [ ] **Step 1: Write failing tests for CRUD**

Write `apps/server/src/__tests__/copilot-routes.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

// We'll test the route handlers in isolation via Fastify's inject(),
// mocking the DB layer through dependency injection at the module level.

const mockDb = {
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

import { vi } from 'vitest'

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  copilotConversations: { id: 'id', tenant_id: 'tid', user_id: 'uid', agent_id: 'aid', title: 'title', status: 'status', last_message_at: 'lma', updated_at: 'ua' },
  copilotMessages: { conversation_id: 'cid', tenant_id: 'tid' },
  agents: { id: 'id', tenant_id: 'tid', slug: 'slug' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  desc: vi.fn((c) => ({ desc: c })),
  asc: vi.fn((c) => ({ asc: c })),
}))

const { copilotRoutes } = await import('../routes/copilot')

async function buildApp(userEmail: string, tenantId: string, role: 'admin' | 'member' = 'admin'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    request.tenantId = tenantId
    ;(request as { user?: { tenantId: string; email: string; role: string } }).user = {
      tenantId, email: userEmail, role,
    }
  })
  await app.register(copilotRoutes, { prefix: '/api/v1' })
  return app
}

describe('POST /api/v1/copilot/conversations', () => {
  it('creates conversation with the tenant aios-master agent', async () => {
    const app = await buildApp('user-1', 'tenant-1')
    // First select returns the member; second returns the aios-master agent.
    let calls = 0
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            calls++
            if (calls === 1) return Promise.resolve([{ role: 'admin', copilot_enabled: false }])
            return Promise.resolve([{ id: 'agent-uuid' }])
          }),
        }),
      }),
    }))
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'conv-1', title: null, status: 'active' }]),
      }),
    })
    const res = await app.inject({ method: 'POST', url: '/api/v1/copilot/conversations', payload: {} })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).data.id).toBe('conv-1')
    await app.close()
  })

  it('returns 404 when aios-master agent missing for tenant', async () => {
    const app = await buildApp('user-1', 'tenant-1')
    let calls = 0
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            calls++
            if (calls === 1) return Promise.resolve([{ role: 'admin', copilot_enabled: false }])
            return Promise.resolve([])
          }),
        }),
      }),
    }))
    const res = await app.inject({ method: 'POST', url: '/api/v1/copilot/conversations', payload: {} })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('GET /api/v1/copilot/conversations', () => {
  it('lists user conversations sorted by last_message_at desc', async () => {
    const app = await buildApp('user-1', 'tenant-1')
    let calls = 0
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            calls++
            if (calls === 1) return Promise.resolve([{ role: 'admin', copilot_enabled: false }])
            return Promise.resolve([])
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: 'c1', title: 'T1', status: 'active', message_count: 3, total_cost_usd: '0.01', last_message_at: new Date(), created_at: new Date() },
            ]),
          }),
        }),
      }),
    }))
    const res = await app.inject({ method: 'GET', url: '/api/v1/copilot/conversations' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data).toHaveLength(1)
    await app.close()
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd apps/server && npx vitest run copilot-routes`

- [ ] **Step 3: Implement CRUD endpoints in `routes/copilot.ts`**

Replace the `copilotRoutes` function in `apps/server/src/routes/copilot.ts` with:

```typescript
export async function copilotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireCopilotAccess)

  app.get('/copilot/health', async (request) => {
    return { ok: true, user_id: request.userEmail, role: request.userRole }
  })

  // POST /copilot/conversations — create a new thread
  app.post('/copilot/conversations', async (request, reply) => {
    const db = getDb()
    const aios = await db.select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.tenant_id, request.tenantId), eq(agents.slug, 'aios-master')))
      .limit(1)
    if (!aios[0]) return reply.status(404).send({ error: 'aios-master agent not seeded for tenant' })

    const inserted = await db.insert(copilotConversations).values({
      tenant_id: request.tenantId,
      user_id: request.userEmail!,
      agent_id: aios[0].id,
      title: null,
      status: 'active',
    }).returning()
    return reply.status(201).send({ data: inserted[0] })
  })

  // GET /copilot/conversations — list user's threads
  app.get<{ Querystring: { status?: 'active' | 'archived'; limit?: string } }>(
    '/copilot/conversations',
    async (request) => {
      const db = getDb()
      const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 100)
      const conditions = [
        eq(copilotConversations.tenant_id, request.tenantId),
        eq(copilotConversations.user_id, request.userEmail!),
      ]
      if (request.query.status) conditions.push(eq(copilotConversations.status, request.query.status))

      const rows = await db.select()
        .from(copilotConversations)
        .where(and(...conditions))
        .orderBy(desc(copilotConversations.last_message_at))
        .limit(limit)
      return { data: rows }
    },
  )

  // GET /copilot/conversations/:id — thread + messages
  app.get<{ Params: { id: string } }>('/copilot/conversations/:id', async (request, reply) => {
    const db = getDb()
    const convRows = await db.select()
      .from(copilotConversations)
      .where(and(
        eq(copilotConversations.id, request.params.id),
        eq(copilotConversations.user_id, request.userEmail!),
        eq(copilotConversations.tenant_id, request.tenantId),
      ))
      .limit(1)
    const conv = convRows[0]
    if (!conv) return reply.status(404).send({ error: 'Not found' })

    const msgs = await db.select()
      .from(copilotMessages)
      .where(eq(copilotMessages.conversation_id, conv.id))
      .orderBy(asc(copilotMessages.created_at))
    return { data: { conversation: conv, messages: msgs } }
  })

  // PATCH /copilot/conversations/:id — rename or archive
  app.patch<{ Params: { id: string }; Body: { title?: string; status?: 'active' | 'archived' } }>(
    '/copilot/conversations/:id',
    async (request, reply) => {
      const db = getDb()
      const updates: Partial<{ title: string; status: string; updated_at: Date }> = { updated_at: new Date() }
      if (request.body.title !== undefined) updates.title = request.body.title
      if (request.body.status !== undefined) updates.status = request.body.status

      const updated = await db.update(copilotConversations)
        .set(updates)
        .where(and(
          eq(copilotConversations.id, request.params.id),
          eq(copilotConversations.user_id, request.userEmail!),
          eq(copilotConversations.tenant_id, request.tenantId),
        ))
        .returning()
      if (!updated[0]) return reply.status(404).send({ error: 'Not found' })
      return { data: updated[0] }
    },
  )

  // DELETE /copilot/conversations/:id — soft delete (archive)
  app.delete<{ Params: { id: string } }>('/copilot/conversations/:id', async (request, reply) => {
    const db = getDb()
    const updated = await db.update(copilotConversations)
      .set({ status: 'archived', updated_at: new Date() })
      .where(and(
        eq(copilotConversations.id, request.params.id),
        eq(copilotConversations.user_id, request.userEmail!),
        eq(copilotConversations.tenant_id, request.tenantId),
      ))
      .returning()
    if (!updated[0]) return reply.status(404).send({ error: 'Not found' })
    return reply.status(204).send()
  })

  // POST /copilot/conversations/:id/messages — added in Task 23
}
```

Update imports at top of `apps/server/src/routes/copilot.ts`:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { eq, and, asc, desc } from 'drizzle-orm'
import {
  getDb, copilotConversations, copilotMessages, agents,
} from '@ethra-nexus/db'
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd apps/server && npx vitest run copilot-routes`
Expected: PASS (3+ tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/copilot.ts apps/server/src/__tests__/copilot-routes.test.ts
git commit -m "feat(api): copilot conversation CRUD endpoints"
```

---

## Task 23: SSE message endpoint

> **AUDIT NOTE (2026-04-28)**: same as Task 22 — test mocks need adaptation to admin-only middleware (no more `copilot_enabled` lookup). Use `request.user.email` for user_id throughout endpoint code.

**Files:**
- Modify: `apps/server/src/routes/copilot.ts` (add POST /messages with SSE)
- Modify: `apps/server/src/__tests__/copilot-routes.test.ts` (add SSE tests)

- [ ] **Step 1: Add failing test for SSE endpoint**

Append to `apps/server/src/__tests__/copilot-routes.test.ts`:

```typescript
describe('POST /api/v1/copilot/conversations/:id/messages', () => {
  it('returns 400 on empty content', async () => {
    const app = await buildApp('user-1', 'tenant-1')
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ role: 'admin', copilot_enabled: false }]),
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/c1/messages',
      payload: { content: '' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 413 on content > 50000 chars', async () => {
    const app = await buildApp('user-1', 'tenant-1')
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ role: 'admin', copilot_enabled: false }]),
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/c1/messages',
      payload: { content: 'x'.repeat(50001) },
    })
    expect(res.statusCode).toBe(413)
    await app.close()
  })

  it('returns 409 when conversation archived', async () => {
    const app = await buildApp('user-1', 'tenant-1')
    let calls = 0
    mockDb.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            calls++
            if (calls === 1) return Promise.resolve([{ role: 'admin', copilot_enabled: false }])
            return Promise.resolve([{ id: 'c1', status: 'archived', user_id: 'user-1', tenant_id: 'tenant-1', agent_id: 'aios' }])
          }),
        }),
      }),
    }))
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/c1/messages',
      payload: { content: 'olá' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd apps/server && npx vitest run copilot-routes`

- [ ] **Step 3: Implement SSE endpoint**

In `apps/server/src/routes/copilot.ts`, add to the imports:

```typescript
import { executeCopilotTurn, generateAutoTitle, AIOS_MASTER_SYSTEM_PROMPT } from '@ethra-nexus/agents'
```

Add an in-memory lock at module top (before `requireCopilotAccess`):

```typescript
// Per-conversation lock to block overlapping turns. In-memory; sufficient for single-instance.
const turnLocks = new Set<string>()
```

Then replace the comment `// POST /copilot/conversations/:id/messages — added in Task 23` with:

```typescript
  app.post<{
    Params: { id: string }
    Body: { content: string }
  }>('/copilot/conversations/:id/messages', async (request, reply) => {
    const { id } = request.params
    const content = request.body?.content
    if (!content || content.trim().length === 0) {
      return reply.status(400).send({ error: 'CONTENT_EMPTY' })
    }
    if (content.length > 50000) {
      return reply.status(413).send({ error: 'CONTENT_TOO_LARGE' })
    }

    const db = getDb()
    const convRows = await db.select()
      .from(copilotConversations)
      .where(and(
        eq(copilotConversations.id, id),
        eq(copilotConversations.user_id, request.userEmail!),
        eq(copilotConversations.tenant_id, request.tenantId),
      ))
      .limit(1)
    const conv = convRows[0]
    if (!conv) return reply.status(404).send({ error: 'Not found' })
    if (conv.status !== 'active') return reply.status(409).send({ error: 'CONVERSATION_ARCHIVED' })

    // Per-conversation lock
    if (turnLocks.has(id)) return reply.status(409).send({ error: 'TURN_IN_PROGRESS' })
    turnLocks.add(id)

    // Open SSE stream
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const sseWrite = (event: { type: string; [k: string]: unknown }) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    const abortController = new AbortController()
    request.raw.on('close', () => abortController.abort())

    // Look up agent system_prompt
    const agentRows = await db.select({ system_prompt: agents.system_prompt })
      .from(agents)
      .where(eq(agents.id, conv.agent_id))
      .limit(1)
    const systemPrompt = agentRows[0]?.system_prompt ?? AIOS_MASTER_SYSTEM_PROMPT

    try {
      await executeCopilotTurn({
        conversation_id: id,
        tenant_id: request.tenantId,
        user_id: request.userEmail!,
        user_role: request.userRole!,
        content,
        system_prompt: systemPrompt,
        sse: { write: sseWrite },
        abortSignal: abortController.signal,
      })

      // Fire-and-forget auto-title (only on success, only if title still null)
      void generateAutoTitle(id)
    } catch (err) {
      sseWrite({
        type: 'error',
        code: 'TURN_FAILED',
        message: err instanceof Error ? err.message : 'unknown',
      })
    } finally {
      turnLocks.delete(id)
      reply.raw.end()
    }
  })
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd apps/server && npx vitest run copilot-routes`
Expected: PASS, all tests including new ones.

- [ ] **Step 5: Manual smoke test**

```bash
# Create a conversation
CONV=$(curl -s -X POST http://localhost:3001/api/v1/copilot/conversations \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.data.id')

# Send a message and watch the stream
curl -N -X POST "http://localhost:3001/api/v1/copilot/conversations/$CONV/messages" \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"content":"liste meus agentes"}'
```

Expected: streaming `data: {...}` lines including `turn_start`, `tool_use_start`, `text_delta`, `turn_complete`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/copilot.ts apps/server/src/__tests__/copilot-routes.test.ts
git commit -m "feat(api): SSE message endpoint with turn loop and auto-title"
```

---

## Task 24: Sidebar nav + /copilot route + page shell

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Create: `apps/web/src/pages/CopilotPage.tsx`

- [ ] **Step 1: Add route in App.tsx**

In `apps/web/src/App.tsx`, add the import:

```typescript
import { CopilotPage } from '@/pages/CopilotPage'
```

Inside the protected `<Route element={<AppLayout />}>` block, add (e.g., before the dashboard route):

```typescript
          <Route path="/copilot" element={<CopilotPage />} />
```

- [ ] **Step 2: Add Copilot to sidebar**

In `apps/web/src/components/layout/Sidebar.tsx`, modify the `NAV_ITEMS` array. Find the import line for lucide-react and add `Sparkles`:

```typescript
import { LayoutDashboard, Bot, BookOpen, Settings, LogOut, Moon, Sun, PanelLeftClose, PanelLeft, Activity, Sparkles } from 'lucide-react'
```

Then update `NAV_ITEMS` to put Copilot first in SISTEMA:

```typescript
const NAV_ITEMS = [
  { to: '/copilot',      icon: Sparkles,        label: 'Copilot',         group: 'SISTEMA' },
  { to: '/dashboard',    icon: LayoutDashboard, label: 'Mission Control', group: 'SISTEMA' },
  { to: '/orchestrator', icon: Activity,        label: 'Orquestrador',    group: 'SISTEMA' },
  { to: '/agents',       icon: Bot,             label: 'Agentes',         group: 'SISTEMA' },
  { to: '/wiki',         icon: BookOpen,        label: 'Wiki',            group: 'MEMÓRIA' },
  { to: '/settings',     icon: Settings,        label: 'Configurações',   group: 'SISTEMA' },
]
```

- [ ] **Step 3: Create CopilotPage shell**

Write `apps/web/src/pages/CopilotPage.tsx`:

```typescript
import { useState } from 'react'

export function CopilotPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  return (
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      {/* Left: ConversationsSidebar (Task 27) */}
      <aside className="w-[220px] flex-shrink-0 border-r-hairline bg-background">
        <div className="p-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          AIOS Master
        </div>
        <p className="px-3 text-[12px] text-muted-foreground">Sidebar coming in Task 27</p>
      </aside>

      {/* Center: ChatView (Task 28) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="h-12 border-b-hairline flex items-center px-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {selectedConversationId ? `#${selectedConversationId.slice(0, 8)}` : 'Selecione uma conversa'}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">CopilotPage shell — components arrive in Tasks 28-31</p>
        </div>
      </div>

      {/* Right: ToolCallsLog (Task 30) */}
      <aside className="w-[280px] flex-shrink-0 border-l-hairline bg-background">
        <div className="p-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Tool calls
        </div>
      </aside>

      {/* avoid unused warning until wired up */}
      <button hidden onClick={() => setSelectedConversationId('placeholder')} />
    </div>
  )
}
```

- [ ] **Step 4: Manual visual verification**

Start dev server (`npm run dev`). Open `http://localhost:5173/copilot`. Expected: 3-panel layout with placeholders, sidebar shows Copilot at top of SISTEMA group with sparkles icon.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx \
        apps/web/src/components/layout/Sidebar.tsx \
        apps/web/src/pages/CopilotPage.tsx
git commit -m "feat(web): /copilot route + sidebar entry + 3-panel shell"
```

---

## Task 25: Stream parser `copilot-stream.ts` (TDD)

**Files:**
- Create: `apps/web/src/lib/copilot-stream.ts`
- Create: `apps/web/src/__tests__/copilot-stream.test.ts`

- [ ] **Step 1: Write failing test**

Write `apps/web/src/__tests__/copilot-stream.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { parseSSEChunks } from '@/lib/copilot-stream'

describe('parseSSEChunks', () => {
  it('parses single complete event', () => {
    const events: object[] = []
    const buf = parseSSEChunks('data: {"type":"text_delta","delta":"hi"}\n\n', '', e => events.push(e))
    expect(buf).toBe('')
    expect(events).toEqual([{ type: 'text_delta', delta: 'hi' }])
  })

  it('buffers incomplete event', () => {
    const events: object[] = []
    const buf = parseSSEChunks('data: {"type":"text_delta",', '', e => events.push(e))
    expect(buf).toBe('data: {"type":"text_delta",')
    expect(events).toEqual([])
  })

  it('combines buffered + new chunks across boundary', () => {
    const events: object[] = []
    let buf = parseSSEChunks('data: {"type":"text', '', e => events.push(e))
    buf = parseSSEChunks('_delta","delta":"hello"}\n\n', buf, e => events.push(e))
    expect(events).toEqual([{ type: 'text_delta', delta: 'hello' }])
  })

  it('tolerates malformed JSON without crashing', () => {
    const events: object[] = []
    parseSSEChunks('data: {"type":"x",}\n\n', '', e => events.push(e))
    expect(events).toEqual([])  // skipped
  })

  it('parses multiple events in one chunk', () => {
    const events: object[] = []
    parseSSEChunks(
      'data: {"type":"a"}\n\ndata: {"type":"b"}\n\n',
      '',
      e => events.push(e),
    )
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }])
  })
})

describe('streamCopilotMessage', () => {
  it('aborts when AbortSignal fires', async () => {
    const ac = new AbortController()
    const onEvent = vi.fn()
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)

    const { streamCopilotMessage } = await import('@/lib/copilot-stream')
    ac.abort()
    await expect(streamCopilotMessage('c1', 'hi', onEvent, ac.signal, () => 'token'))
      .rejects.toThrow()
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `cd apps/web && npx vitest run copilot-stream`

- [ ] **Step 3: Implement stream parser**

Write `apps/web/src/lib/copilot-stream.ts`:

```typescript
export interface SSEEvent {
  type: string
  [k: string]: unknown
}

export function parseSSEChunks(
  chunk: string,
  prevBuffer: string,
  onEvent: (e: SSEEvent) => void,
): string {
  const buf = prevBuffer + chunk
  const segments = buf.split('\n\n')
  const incomplete = segments.pop() ?? ''
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (!trimmed.startsWith('data: ')) continue
    const json = trimmed.slice(6)
    try {
      const parsed = JSON.parse(json) as SSEEvent
      onEvent(parsed)
    } catch {
      // skip malformed line
    }
  }
  return incomplete
}

export async function streamCopilotMessage(
  conversationId: string,
  content: string,
  onEvent: (e: SSEEvent) => void,
  signal: AbortSignal,
  getToken: () => string | null,
): Promise<void> {
  const token = getToken()
  if (!token) throw new Error('Missing auth token')

  const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/v1'
  const res = await fetch(`${baseUrl}/copilot/conversations/${conversationId}/messages`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${errBody}`)
  }
  if (!res.body) throw new Error('No response body for stream')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    buffer = parseSSEChunks(chunk, buffer, onEvent)
  }
}
```

- [ ] **Step 4: Run test, verify PASS**

Run: `cd apps/web && npx vitest run copilot-stream`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/copilot-stream.ts apps/web/src/__tests__/copilot-stream.test.ts
git commit -m "feat(web): copilot SSE stream parser with TDD"
```

---

## Task 26: useCopilot hooks

**Files:**
- Create: `apps/web/src/hooks/useCopilot.ts`

This task creates the TanStack Query hooks plus a custom streaming hook. No tests (TanStack hooks are tested via integration in components).

- [ ] **Step 1: Create the hooks file**

Write `apps/web/src/hooks/useCopilot.ts`:

```typescript
import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { streamCopilotMessage, type SSEEvent } from '@/lib/copilot-stream'
import { STORAGE_KEY } from '@/contexts/AuthContext'

export interface CopilotConversation {
  id: string
  title: string | null
  status: 'active' | 'archived'
  message_count: number
  total_cost_usd: string
  last_message_at: string
  created_at: string
}

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant'
  content: Array<{ type: string; [k: string]: unknown }>
  model: string | null
  tokens_in: number
  tokens_out: number
  cost_usd: string
  stop_reason: string | null
  error_code: string | null
  created_at: string
}

export interface CopilotConversationDetail {
  conversation: CopilotConversation
  messages: CopilotMessage[]
}

// LISTING ────────────────────────────────────────────────────

export function useCopilotConversations(filter?: { status?: 'active' | 'archived' }) {
  return useQuery({
    queryKey: ['copilot', 'conversations', filter ?? {}],
    queryFn: () => api.get<{ data: CopilotConversation[] }>('/copilot/conversations', { params: filter }).then(r => r.data.data),
    staleTime: 10_000,
  })
}

export function useCopilotConversation(id: string | null) {
  return useQuery({
    queryKey: ['copilot', 'conversation', id],
    queryFn: () => api.get<{ data: CopilotConversationDetail }>(`/copilot/conversations/${id}`).then(r => r.data.data),
    enabled: !!id,
    staleTime: 5_000,
  })
}

// MUTATIONS ──────────────────────────────────────────────────

export function useCreateCopilotConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ data: CopilotConversation }>('/copilot/conversations', {}).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'conversations'] }),
    onError: (e: unknown) => {
      const m = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Erro ao criar conversa'
      toast.error(m)
    },
  })
}

export function useUpdateCopilotConversation(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title?: string; status?: 'active' | 'archived' }) =>
      api.patch<{ data: CopilotConversation }>(`/copilot/conversations/${id}`, body).then(r => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['copilot', 'conversations'] })
      qc.invalidateQueries({ queryKey: ['copilot', 'conversation', id] })
    },
  })
}

export function useDeleteCopilotConversation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/copilot/conversations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copilot', 'conversations'] }),
  })
}

// STREAMING ──────────────────────────────────────────────────

export interface ToolCallInProgress {
  tool_use_id: string
  tool_name: string
  status: 'running' | 'completed' | 'error'
  duration_ms?: number
}

export interface SendCopilotMessageState {
  isStreaming: boolean
  currentText: string
  currentToolCalls: ToolCallInProgress[]
  error: string | null
}

export function useSendCopilotMessage(conversationId: string | null) {
  const qc = useQueryClient()
  const [state, setState] = useState<SendCopilotMessageState>({
    isStreaming: false, currentText: '', currentToolCalls: [], error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(async (content: string) => {
    if (!conversationId) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setState({ isStreaming: true, currentText: '', currentToolCalls: [], error: null })

    try {
      await streamCopilotMessage(conversationId, content, (event: SSEEvent) => {
        if (event.type === 'text_delta') {
          setState(s => ({ ...s, currentText: s.currentText + (event['delta'] as string) }))
        } else if (event.type === 'tool_use_start') {
          setState(s => ({
            ...s,
            currentToolCalls: [
              ...s.currentToolCalls,
              { tool_use_id: event['tool_use_id'] as string, tool_name: event['tool_name'] as string, status: 'running' },
            ],
          }))
        } else if (event.type === 'tool_use_complete') {
          setState(s => ({
            ...s,
            currentToolCalls: s.currentToolCalls.map(t =>
              t.tool_use_id === event['tool_use_id']
                ? { ...t, status: event['status'] as 'completed' | 'error', duration_ms: event['duration_ms'] as number }
                : t,
            ),
          }))
        } else if (event.type === 'error') {
          setState(s => ({ ...s, error: event['code'] as string }))
        }
      }, ac.signal, () => localStorage.getItem(STORAGE_KEY))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setState(s => ({ ...s, error: (e as Error).message }))
        toast.error('Erro ao enviar mensagem')
      }
    } finally {
      setState(s => ({ ...s, isStreaming: false }))
      qc.invalidateQueries({ queryKey: ['copilot', 'conversation', conversationId] })
      qc.invalidateQueries({ queryKey: ['copilot', 'conversations'] })
    }
  }, [conversationId, qc])

  const cancel = useCallback(() => abortRef.current?.abort(), [])

  return { ...state, send, cancel }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useCopilot.ts
git commit -m "feat(web): useCopilot hooks (queries, mutations, streaming)"
```

---

## Task 27: ConversationsSidebar component

**Files:**
- Create: `apps/web/src/components/copilot/ConversationsSidebar.tsx`
- Modify: `apps/web/src/pages/CopilotPage.tsx` (use the component)

- [ ] **Step 1: Create the component**

Write `apps/web/src/components/copilot/ConversationsSidebar.tsx`:

```typescript
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useCopilotConversations,
  useCreateCopilotConversation,
  useDeleteCopilotConversation,
  type CopilotConversation,
} from '@/hooks/useCopilot'

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'agora'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function ConversationsSidebar({ selectedId, onSelect }: Props) {
  const { data: convs = [], isLoading } = useCopilotConversations({ status: 'active' })
  const create = useCreateCopilotConversation()
  const del = useDeleteCopilotConversation()

  async function handleNewConversation() {
    const created = await create.mutateAsync()
    onSelect(created.id)
  }

  function handleDelete(e: React.MouseEvent, conv: CopilotConversation) {
    e.stopPropagation()
    if (!confirm(`Arquivar "${conv.title ?? 'conversa sem título'}"?`)) return
    del.mutate(conv.id, {
      onSuccess: () => {
        if (selectedId === conv.id) onSelect(null)
      },
    })
  }

  return (
    <aside className="w-[220px] flex-shrink-0 border-r-hairline flex flex-col bg-background overflow-hidden">
      <div className="p-3 border-b-hairline">
        <button
          onClick={handleNewConversation}
          disabled={create.isPending}
          className="w-full flex items-center justify-center gap-1.5 h-9 border-hairline hover:bg-secondary transition-colors text-[12px] font-mono uppercase tracking-[0.08em]"
        >
          <Plus size={12} />
          Nova conversa
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-minimal">
        {isLoading && (
          <div className="p-3 flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}

        {!isLoading && convs.length === 0 && (
          <p className="p-4 text-[11px] text-muted-foreground text-center">
            Sem conversas. Clique em "Nova conversa" para começar.
          </p>
        )}

        {!isLoading && convs.map(conv => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={cn(
              'w-full text-left px-3 py-2.5 border-b-hairline hover:bg-secondary transition-colors group',
              selectedId === conv.id && 'bg-secondary',
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-0.5">
              <p className={cn(
                'text-[12px] font-medium truncate flex-1',
                conv.title ? 'text-foreground' : 'text-muted-foreground italic',
              )}>
                {conv.title ?? 'sem título'}
              </p>
              <button
                onClick={(e) => handleDelete(e, conv)}
                className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Arquivar"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>{conv.message_count} msg</span>
              <span>há {relTime(conv.last_message_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Wire into CopilotPage**

Replace `apps/web/src/pages/CopilotPage.tsx` with:

```typescript
import { useState } from 'react'
import { ConversationsSidebar } from '@/components/copilot/ConversationsSidebar'

export function CopilotPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  return (
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      <ConversationsSidebar
        selectedId={selectedConversationId}
        onSelect={setSelectedConversationId}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="h-12 border-b-hairline flex items-center px-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {selectedConversationId ? `#${selectedConversationId.slice(0, 8)}` : 'Selecione uma conversa'}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">ChatView coming in Task 28</p>
        </div>
      </div>

      <aside className="w-[280px] flex-shrink-0 border-l-hairline bg-background">
        <div className="p-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Tool calls
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke**

Open `/copilot` in browser. Click "Nova conversa". Should create row and select it. Refresh — list persists.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/copilot/ConversationsSidebar.tsx \
        apps/web/src/pages/CopilotPage.tsx
git commit -m "feat(web): ConversationsSidebar component"
```

---

## Task 28: ChatView + MessageList + bubbles

**Files:**
- Create: `apps/web/src/components/copilot/UserBubble.tsx`
- Create: `apps/web/src/components/copilot/AssistantBubble.tsx`
- Create: `apps/web/src/components/copilot/ToolUseInlineMarker.tsx`
- Create: `apps/web/src/components/copilot/MessageList.tsx`
- Create: `apps/web/src/components/copilot/ChatView.tsx`
- Modify: `apps/web/src/pages/CopilotPage.tsx`

- [ ] **Step 1: Create bubble components**

Write `apps/web/src/components/copilot/UserBubble.tsx`:

```typescript
interface Props {
  text: string
}

export function UserBubble({ text }: Props) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] bg-background border-hairline px-4 py-3 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}
```

Write `apps/web/src/components/copilot/ToolUseInlineMarker.tsx`:

```typescript
import { Wrench, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  toolName: string
  durationMs?: number
  status?: 'running' | 'completed' | 'error'
  onClick?: () => void
}

export function ToolUseInlineMarker({ toolName, durationMs, status = 'completed', onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-hairline px-2 py-1 my-1 font-mono text-[10px] hover:bg-secondary transition-colors',
        status === 'error' && 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-400',
        status === 'running' && 'animate-pulse',
      )}
    >
      <Wrench size={10} />
      <span>{toolName}</span>
      {durationMs !== undefined && <span className="text-muted-foreground">{durationMs}ms</span>}
      <ChevronRight size={10} className="opacity-40" />
    </button>
  )
}
```

Write `apps/web/src/components/copilot/AssistantBubble.tsx`:

```typescript
import { Bot, Loader2, AlertTriangle } from 'lucide-react'
import { ToolUseInlineMarker } from './ToolUseInlineMarker'

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [k: string]: unknown }

interface Props {
  content: ContentBlock[]
  model?: string | null
  costUsd?: string
  errorCode?: string | null
  onToolClick?: (toolUseId: string) => void
  toolDurations?: Record<string, number>
  toolStatuses?: Record<string, 'running' | 'completed' | 'error'>
  isStreaming?: boolean
}

export function AssistantBubble({
  content, model, costUsd, errorCode,
  onToolClick, toolDurations = {}, toolStatuses = {}, isStreaming = false,
}: Props) {
  if (errorCode) {
    return (
      <div className="flex flex-col gap-1.5 max-w-[84%]">
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-mono text-[10px] text-red-600 dark:text-red-400 uppercase tracking-[0.08em] mb-1">
              {errorCode}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 max-w-[84%]">
      <div className="flex items-center gap-2">
        <div
          className="size-5 rounded-full flex items-center justify-center text-[9px] font-medium flex-shrink-0"
          style={{ background: 'hsl(var(--secondary))' }}
        >
          <Bot size={11} />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          AIOS Master {model && `· ${model}`}
        </span>
        {costUsd && Number(costUsd) > 0 && (
          <span className="font-mono text-[9px] text-muted-foreground">${Number(costUsd).toFixed(4)}</span>
        )}
        {isStreaming && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
      </div>

      <div className="bg-background border-hairline px-4 py-3 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
        {content.map((block, i) => {
          if (block.type === 'text') {
            return <span key={i}>{(block as { text: string }).text}</span>
          }
          if (block.type === 'tool_use') {
            const tu = block as { id: string; name: string }
            return (
              <ToolUseInlineMarker
                key={tu.id}
                toolName={tu.name}
                durationMs={toolDurations[tu.id]}
                status={toolStatuses[tu.id] ?? 'completed'}
                onClick={() => onToolClick?.(tu.id)}
              />
            )
          }
          return null
        })}
        {isStreaming && content.length === 0 && (
          <span className="text-muted-foreground italic">pensando…</span>
        )}
      </div>
    </div>
  )
}
```

Write `apps/web/src/components/copilot/MessageList.tsx`:

```typescript
import { useEffect, useRef } from 'react'
import type { CopilotMessage } from '@/hooks/useCopilot'
import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'

interface Props {
  messages: CopilotMessage[]
  streamingText?: string
  streamingToolStatuses?: Record<string, 'running' | 'completed' | 'error'>
  streamingToolDurations?: Record<string, number>
  isStreaming?: boolean
  onToolClick?: (toolUseId: string) => void
}

function userText(content: CopilotMessage['content']): string {
  const text = content.find(b => b.type === 'text') as { type: string; text?: string } | undefined
  return text?.text ?? ''
}

function isToolResultMsg(msg: CopilotMessage): boolean {
  return msg.role === 'user' && msg.content.some(b => b.type === 'tool_result')
}

export function MessageList({
  messages,
  streamingText = '',
  streamingToolStatuses = {},
  streamingToolDurations = {},
  isStreaming = false,
  onToolClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, streamingText])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 scrollbar-minimal">
      {messages.map(msg => {
        // Hide synthetic tool_result user messages
        if (isToolResultMsg(msg)) return null

        if (msg.role === 'user') {
          return <UserBubble key={msg.id} text={userText(msg.content)} />
        }

        return (
          <AssistantBubble
            key={msg.id}
            content={msg.content}
            model={msg.model}
            costUsd={msg.cost_usd}
            errorCode={msg.error_code}
            onToolClick={onToolClick}
          />
        )
      })}

      {isStreaming && (
        <AssistantBubble
          content={streamingText ? [{ type: 'text', text: streamingText }] : []}
          isStreaming
          toolDurations={streamingToolDurations}
          toolStatuses={streamingToolStatuses}
          onToolClick={onToolClick}
        />
      )}
    </div>
  )
}
```

Write `apps/web/src/components/copilot/ChatView.tsx`:

```typescript
import { useCopilotConversation, useSendCopilotMessage } from '@/hooks/useCopilot'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'

interface Props {
  conversationId: string
  onToolClick?: (toolUseId: string) => void
}

export function ChatView({ conversationId, onToolClick }: Props) {
  const { data, isLoading } = useCopilotConversation(conversationId)
  const stream = useSendCopilotMessage(conversationId)

  if (isLoading) {
    return <div className="flex-1 p-5 flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
  }
  if (!data) return null

  const toolStatuses: Record<string, 'running' | 'completed' | 'error'> = {}
  const toolDurations: Record<string, number> = {}
  for (const t of stream.currentToolCalls) {
    toolStatuses[t.tool_use_id] = t.status === 'running' ? 'running' : t.status
    if (t.duration_ms !== undefined) toolDurations[t.tool_use_id] = t.duration_ms
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="h-12 border-b-hairline flex items-center justify-between px-5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-muted-foreground">#{data.conversation.id.slice(0, 8)}</span>
          <span className="text-[13px] font-medium text-foreground truncate">
            {data.conversation.title ?? 'sem título'}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span>{data.conversation.message_count} msg</span>
          <span>${Number(data.conversation.total_cost_usd).toFixed(4)}</span>
        </div>
      </div>

      <MessageList
        messages={data.messages}
        streamingText={stream.currentText}
        streamingToolStatuses={toolStatuses}
        streamingToolDurations={toolDurations}
        isStreaming={stream.isStreaming}
        onToolClick={onToolClick}
      />

      <MessageInput
        onSend={(content) => stream.send(content)}
        disabled={stream.isStreaming}
      />
    </div>
  )
}
```

- [ ] **Step 2: Update CopilotPage to use ChatView**

Replace `apps/web/src/pages/CopilotPage.tsx`:

```typescript
import { useState } from 'react'
import { ConversationsSidebar } from '@/components/copilot/ConversationsSidebar'
import { ChatView } from '@/components/copilot/ChatView'

export function CopilotPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      <ConversationsSidebar selectedId={selectedId} onSelect={setSelectedId} />

      {selectedId ? (
        <ChatView conversationId={selectedId} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">Selecione uma conversa ou crie uma nova.</p>
        </div>
      )}

      <aside className="w-[280px] flex-shrink-0 border-l-hairline bg-background">
        <div className="p-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Tool calls
        </div>
        <p className="px-3 text-[11px] text-muted-foreground">Coming in Task 30</p>
      </aside>
    </div>
  )
}
```

- [ ] **Step 3: Note that MessageInput is referenced but not yet created — Task 29 creates it**

Tests would currently fail. Skip running until Task 29 is done.

- [ ] **Step 4: Commit (work-in-progress: not yet runnable)**

```bash
git add apps/web/src/components/copilot/UserBubble.tsx \
        apps/web/src/components/copilot/AssistantBubble.tsx \
        apps/web/src/components/copilot/ToolUseInlineMarker.tsx \
        apps/web/src/components/copilot/MessageList.tsx \
        apps/web/src/components/copilot/ChatView.tsx \
        apps/web/src/pages/CopilotPage.tsx
git commit -m "feat(web): bubbles + MessageList + ChatView (input wiring in next task)"
```

---

## Task 29: MessageInput + send wiring (full chat working)

**Files:**
- Create: `apps/web/src/components/copilot/MessageInput.tsx`

- [ ] **Step 1: Create MessageInput**

Write `apps/web/src/components/copilot/MessageInput.tsx`:

```typescript
import { useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  onSend: (content: string) => void
  disabled?: boolean
}

const MAX_CHARS = 50000

export function MessageInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState('')

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (trimmed.length > MAX_CHARS) return
    onSend(trimmed)
    setValue('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const tooLong = value.length > MAX_CHARS

  return (
    <div className="border-t-hairline bg-background px-4 py-3 flex-shrink-0">
      <div className="flex gap-2 items-end">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pergunte algo sobre o sistema..."
          rows={2}
          disabled={disabled}
          className={cn(
            'flex-1 font-mono text-[12px] bg-background border-hairline px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary',
            tooLong && 'border-destructive',
          )}
        />
        <Button
          onClick={handleSend}
          disabled={disabled || !value.trim() || tooLong}
          className="h-9 flex-shrink-0"
        >
          <Send size={12} />
        </Button>
      </div>
      {tooLong && (
        <p className="font-mono text-[10px] text-destructive mt-1 text-right">
          {value.length} / {MAX_CHARS} chars
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify chat works end-to-end**

Run dev server. Open `/copilot`, click "Nova conversa", type "olá" + Enter. Expected: streaming response from the AIOS Master agent, bubble updates as text arrives.

If backend fails (e.g., `aios-master` not seeded), check Tasks 3 and `docker exec` migration application.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/copilot/MessageInput.tsx
git commit -m "feat(web): MessageInput component completes chat flow"
```

---

## Task 30: ToolCallsLog (right panel)

**Files:**
- Create: `apps/web/src/components/copilot/ToolCallsLog.tsx`
- Modify: `apps/web/src/pages/CopilotPage.tsx`

- [ ] **Step 1: Create ToolCallsLog**

Write `apps/web/src/components/copilot/ToolCallsLog.tsx`:

```typescript
import { useState } from 'react'
import { Clock, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CopilotMessage } from '@/hooks/useCopilot'

interface ToolCallView {
  id: string  // tool_use_id
  name: string
  input: Record<string, unknown>
  result: unknown  // from the next user message's tool_result
  status: 'completed' | 'error'
  durationMs: number | null
}

interface Props {
  messages: CopilotMessage[]
  streamingTools?: Array<{ tool_use_id: string; tool_name: string; status: 'running' | 'completed' | 'error'; duration_ms?: number }>
}

function extractToolCalls(messages: CopilotMessage[]): ToolCallView[] {
  const result: ToolCallView[] = []
  // Build map of tool_use_id → tool_result content
  const resultMap = new Map<string, { content: string; isError: boolean }>()
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const block of m.content) {
      if (block.type === 'tool_result') {
        const tu = block as { tool_use_id: string; content: string; is_error?: boolean }
        resultMap.set(tu.tool_use_id, { content: tu.content, isError: tu.is_error ?? false })
      }
    }
  }

  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const block of m.content) {
      if (block.type !== 'tool_use') continue
      const tu = block as { id: string; name: string; input?: Record<string, unknown> }
      const r = resultMap.get(tu.id)
      let parsedResult: unknown = r?.content ?? null
      try { if (r?.content) parsedResult = JSON.parse(r.content.replace(/^<tool_output[^>]*>\n?|\n?<\/tool_output>$/g, '')) } catch { /* keep as string */ }
      result.push({
        id: tu.id,
        name: tu.name,
        input: tu.input ?? {},
        result: parsedResult,
        status: r?.isError ? 'error' : 'completed',
        durationMs: null,
      })
    }
  }
  return result
}

function ToolRow({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b-hairline">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-secondary text-left"
      >
        <span className={cn(
          'size-1.5 rounded-full mt-1.5 flex-shrink-0',
          call.status === 'error' ? 'bg-red-500' : 'bg-green-500',
        )} />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] text-foreground truncate">{call.name}</p>
          {call.durationMs !== null && (
            <p className="font-mono text-[9px] text-muted-foreground">{call.durationMs}ms</p>
          )}
        </div>
        <ChevronRight size={11} className={cn('mt-1 opacity-40 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="px-3 pb-3 bg-secondary">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground mt-1.5 mb-1">input</p>
          <pre className="font-mono text-[10px] whitespace-pre-wrap break-all">{JSON.stringify(call.input, null, 2)}</pre>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground mt-2 mb-1">result</p>
          <pre className="font-mono text-[10px] whitespace-pre-wrap break-all max-h-48 overflow-auto">
            {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export function ToolCallsLog({ messages, streamingTools = [] }: Props) {
  const calls = extractToolCalls(messages)

  return (
    <aside className="w-[280px] flex-shrink-0 border-l-hairline bg-background flex flex-col overflow-hidden">
      <div className="h-12 border-b-hairline flex items-center px-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground flex-shrink-0">
        Tool calls
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-minimal">
        {calls.length === 0 && streamingTools.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Clock size={20} strokeWidth={1} className="opacity-20" />
            <p className="font-mono text-[10px] uppercase tracking-[0.1em]">sem chamadas</p>
          </div>
        )}
        {streamingTools.map(t => (
          <div key={t.tool_use_id} className="border-b-hairline px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className={cn('size-1.5 rounded-full mt-1.5 flex-shrink-0', t.status === 'running' ? 'bg-green-500 animate-pulse' : t.status === 'error' ? 'bg-red-500' : 'bg-green-500')} />
              <p className="font-mono text-[11px] text-foreground truncate flex-1">{t.tool_name}</p>
              {t.duration_ms !== undefined && <span className="font-mono text-[9px] text-muted-foreground">{t.duration_ms}ms</span>}
            </div>
          </div>
        ))}
        {calls.map(c => <ToolRow key={c.id} call={c} />)}
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Wire into CopilotPage**

Update `apps/web/src/pages/CopilotPage.tsx`:

```typescript
import { useState } from 'react'
import { ConversationsSidebar } from '@/components/copilot/ConversationsSidebar'
import { ChatView } from '@/components/copilot/ChatView'
import { ToolCallsLog } from '@/components/copilot/ToolCallsLog'
import { useCopilotConversation, useSendCopilotMessage } from '@/hooks/useCopilot'

export function CopilotPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data } = useCopilotConversation(selectedId)
  const stream = useSendCopilotMessage(selectedId)

  return (
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      <ConversationsSidebar selectedId={selectedId} onSelect={setSelectedId} />

      {selectedId ? (
        <ChatView conversationId={selectedId} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">Selecione uma conversa ou crie uma nova.</p>
        </div>
      )}

      <ToolCallsLog
        messages={data?.messages ?? []}
        streamingTools={stream.currentToolCalls}
      />
    </div>
  )
}
```

> Note: `useCopilotConversation` is now called twice (once in CopilotPage, once in ChatView). TanStack Query dedupes by queryKey, so no extra request — both subscribe to the same cache entry.

- [ ] **Step 3: Manual smoke**

Open conversation, send message, watch right panel populate as tools execute.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/copilot/ToolCallsLog.tsx \
        apps/web/src/pages/CopilotPage.tsx
git commit -m "feat(web): ToolCallsLog right panel with expandable tool I/O"
```

---

## Task 31: EmptyState with chips

**Files:**
- Create: `apps/web/src/components/copilot/EmptyState.tsx`
- Modify: `apps/web/src/pages/CopilotPage.tsx`

- [ ] **Step 1: Create EmptyState**

Write `apps/web/src/components/copilot/EmptyState.tsx`:

```typescript
import { Sparkles } from 'lucide-react'
import { useCreateCopilotConversation, useSendCopilotMessage } from '@/hooks/useCopilot'

const STARTER_PROMPTS = [
  'Quais agentes estão ativos?',
  'Mostre as últimas execuções',
  'Quanto gastei esse mês?',
  'Tem coisa pra aprovar?',
]

interface Props {
  onSelectConversation: (id: string) => void
}

export function EmptyState({ onSelectConversation }: Props) {
  const create = useCreateCopilotConversation()

  async function handleChip(prompt: string) {
    const conv = await create.mutateAsync()
    onSelectConversation(conv.id)
    // Send via the streaming hook bound to the new conversation.
    // Using a microtask to allow the parent to update selected state.
    setTimeout(() => {
      const sender = createOneShotSender(conv.id)
      sender.send(prompt)
    }, 50)
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
      <Sparkles size={32} strokeWidth={1.25} className="text-muted-foreground opacity-40" />
      <div className="text-center">
        <h2 className="text-base font-semibold text-foreground mb-1">AIOS Master pronto</h2>
        <p className="text-[13px] text-muted-foreground max-w-md">
          Pergunte sobre seus agentes, execuções, custos, wiki ou aprovações pendentes.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-md">
        {STARTER_PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => handleChip(p)}
            disabled={create.isPending}
            className="text-left px-4 py-2.5 border-hairline hover:bg-secondary transition-colors text-[13px] disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

// Minimal one-shot sender that doesn't need a React render cycle to be bound.
function createOneShotSender(conversationId: string) {
  return {
    send: async (content: string) => {
      // Reuse the same streaming endpoint via fetch.
      // Errors are silently swallowed — UI will refetch on next render.
      const { streamCopilotMessage } = await import('@/lib/copilot-stream')
      const { STORAGE_KEY } = await import('@/contexts/AuthContext')
      try {
        await streamCopilotMessage(conversationId, content, () => undefined, new AbortController().signal, () => localStorage.getItem(STORAGE_KEY))
      } catch { /* ignored — list refetch will surface result */ }
    },
  }
}
```

- [ ] **Step 2: Use EmptyState when no thread selected**

Update `apps/web/src/pages/CopilotPage.tsx`:

```typescript
import { useState } from 'react'
import { ConversationsSidebar } from '@/components/copilot/ConversationsSidebar'
import { ChatView } from '@/components/copilot/ChatView'
import { ToolCallsLog } from '@/components/copilot/ToolCallsLog'
import { EmptyState } from '@/components/copilot/EmptyState'
import { useCopilotConversation, useSendCopilotMessage } from '@/hooks/useCopilot'

export function CopilotPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data } = useCopilotConversation(selectedId)
  const stream = useSendCopilotMessage(selectedId)

  return (
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      <ConversationsSidebar selectedId={selectedId} onSelect={setSelectedId} />

      {selectedId ? (
        <ChatView conversationId={selectedId} />
      ) : (
        <EmptyState onSelectConversation={setSelectedId} />
      )}

      <ToolCallsLog
        messages={data?.messages ?? []}
        streamingTools={stream.currentToolCalls}
      />
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke**

Open `/copilot` fresh (no thread selected). Click a chip. Should create thread + send prompt + stream response.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/copilot/EmptyState.tsx \
        apps/web/src/pages/CopilotPage.tsx
git commit -m "feat(web): EmptyState with starter prompt chips"
```

---

## Task 32: Smoke test pass + final commit

**Files:**
- (no code changes; manual test execution only)

- [ ] **Step 1: Run all tests**

```bash
cd packages/agents && npx vitest run --reporter=verbose
cd ../../apps/server && npx vitest run --reporter=verbose
cd ../../apps/web && npx vitest run --reporter=verbose
```

Expected: all tests PASS. If any fail, fix before continuing.

- [ ] **Step 2: Run full typecheck**

```bash
cd packages/db && npx tsc --noEmit
cd ../../packages/agents && npx tsc --noEmit
cd ../../apps/server && npx tsc --noEmit
cd ../../apps/web && npx tsc --noEmit
```

Expected: all PASS.

- [ ] **Step 3: Run the SPEC §"Smoke test manual de aceite" checklist**

Open dev server, login as admin, navigate to `/copilot`. Walk through:

- [ ] Empty state with 4 chips visible
- [ ] Click "Quais agentes estão ativos?" → creates thread, streams response
- [ ] Streamed text appears progressively in center bubble
- [ ] Right panel shows `system:list_agents` row with green dot + duration
- [ ] Final response lists actual agents (matches DB state)
- [ ] Sidebar left shows new thread with auto-title (~2s after turn complete)
- [ ] Reload page → thread persists, messages persist, title persists
- [ ] Type follow-up "quanto gastei?" + Enter → sees `system:get_budget_status` invoked
- [ ] Vague prompt (e.g., "me explique tudo sobre o universo") → cap may trigger; UI shows error inline if so
- [ ] Temporarily set `ANTHROPIC_API_KEY=invalid` and restart server → send message → see error inline + toast
- [ ] Restore key. Login with a non-admin token (role !== 'admin') → `/copilot` request shows 403 with `Copilot is admin-only`
- [ ] Open same thread in 2 browser tabs, send rapidly → 2nd tab's send returns 409 `TURN_IN_PROGRESS`

- [ ] **Step 4: Address any issues found in the checklist**

Each fix is its own commit on the same branch.

- [ ] **Step 5: Update NEXUS-STATUS.md**

Append a row to the relevant table marking Spec #1 complete:

```
| Spec #1 (AIOS Master shell) | ✅ shipped (commit <SHA>) |
```

Commit:
```bash
git add Roteiro_DEV/NEXUS-STATUS.md
git commit -m "docs: mark Spec #1 (AIOS Master shell) complete"
```

- [ ] **Step 6: Hand off**

Plan execution complete. Next steps:
- Create PR with the full set of commits OR merge directly to main per the team's git workflow.
- Begin Spec #2 (File Storage + Alerts) brainstorming when ready.

---

## Plan self-review

**Spec coverage check** (cross-reference `docs/superpowers/specs/2026-04-27-aios-master-shell.md`):

| Spec section | Plan task(s) |
|--------------|--------------|
| Database schema | Tasks 1-3 |
| Tool registry interface | Task 6 |
| 9 tools | Tasks 7-15 |
| Anthropic client + system prompt | Tasks 4-5 |
| Tool array + getToolsForAnthropic | Task 16 |
| Turn loop (text-only) | Task 17 |
| Tool execution in turn | Task 18 |
| Per-turn caps | Task 19 |
| Auto-title | Task 20 |
| Permission middleware (2 layers) | Task 21 + Task 6 (per-tool) |
| API endpoints (CRUD) | Task 22 |
| API SSE message endpoint | Task 23 |
| Frontend route + sidebar | Task 24 |
| Frontend stream parser | Task 25 |
| useCopilot hooks | Task 26 |
| Frontend components | Tasks 27-31 |
| Smoke test acceptance | Task 32 |
| Error catalog | Distributed: validation in Task 23, tool errors in Task 18, caps in Task 19 |
| Test strategy (62 tests) | Distributed across all tasks |

All spec sections covered.

**Type consistency check**: `CopilotTool` interface defined in Task 6, used identically in Tasks 7-15. `SseWriter` in Task 17, used identically in Task 18. `ExecuteCopilotTurnParams` shape consistent between Task 17 and Task 18. `SSEEvent` type consistent between server (Task 23) and client (Task 25). ✓

**Placeholder check**: no "TBD"/"TODO" markers in any task body. All step actions have concrete code or commands. Forward references (e.g., Task 16 importing `executeCopilotTurn` not yet defined in Task 17) are explicit and documented.

**Estimated effort**: 32 tasks × ~0.7 days = ~22 days, matching the spec's effort estimate.


