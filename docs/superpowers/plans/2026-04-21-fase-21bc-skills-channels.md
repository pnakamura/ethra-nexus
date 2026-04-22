# Fase 21BC — Gerenciamento Individual de Skills e Canais

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar 6 endpoints REST para gerenciar skills e canais individualmente por agente (`POST/PATCH/DELETE /agents/:id/skills` e `POST/PATCH/DELETE /agents/:id/channels`).

**Architecture:** Dois novos arquivos de rota (`agent-skills.ts` e `agent-channels.ts`) registrados em `app.ts`. Cada endpoint verifica que o agente existe e pertence ao tenant antes de operar. POST cria estritamente (409 se já existe), PATCH faz merge parcial do config, DELETE remove com hard delete.

**Tech Stack:** Fastify 5, Drizzle ORM, TypeScript strict, Vitest. Validators reutilizados de `apps/server/src/routes/agents.types.ts`.

---

## Arquivo de referência — agents.types.ts

Este arquivo já existe em `apps/server/src/routes/agents.types.ts` e exporta `isValidSkillId`, `isValidChannelType`, `validateChannelConfig`. Não modificar — apenas importar.

## Arquivo de referência — agentSkills schema

Tabela `agent_skills` (Drizzle, `packages/db/src/schema/core.ts`):
- `id: uuid pk`
- `agent_id: uuid NOT NULL` FK → agents
- `tenant_id: uuid NOT NULL`
- `skill_name: text NOT NULL`
- `skill_config: jsonb default {}`
- `enabled: boolean default true`
- `created_at: timestamp`
- UNIQUE `(agent_id, skill_name)`

## Arquivo de referência — agentChannels schema

Tabela `agent_channels` (Drizzle, `packages/db/src/schema/core.ts`):
- `id: uuid pk`
- `agent_id: uuid NOT NULL` FK → agents ON DELETE CASCADE
- `tenant_id: uuid NOT NULL`
- `channel_type: text NOT NULL`
- `enabled: boolean default true`
- `config: jsonb NOT NULL default {}`
- `created_at: timestamp`
- `updated_at: timestamp`
- UNIQUE `(agent_id, channel_type)`

---

## Task 1: agent-skills.ts — POST, PATCH, DELETE

**Files:**
- Create: `apps/server/src/routes/agent-skills.ts`
- Modify: `apps/server/src/app.ts` (import + register)
- Modify: `apps/server/src/__tests__/e2e/agents.test.ts` (adicionar describe block)

- [ ] **Step 1: Criar `apps/server/src/routes/agent-skills.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents, agentSkills } from '@ethra-nexus/db'
import { isValidSkillId } from './agents.types'

export async function agentSkillsRoutes(app: FastifyInstance) {
  async function requireAgent(agentId: string, tenantId: string) {
    const db = getDb()
    const rows = await db
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
      .limit(1)
    const agent = rows[0]
    if (!agent || agent.status === 'archived') return null
    return agent
  }

  // POST /agents/:id/skills — cria skill (409 se já existe)
  app.post<{
    Params: { id: string }
    Body: {
      skill_id: string
      enabled?: boolean
      provider_override?: { provider: string; model: string }
      max_tokens_per_call?: number
      max_calls_per_hour?: number
      timeout_ms?: number
    }
  }>('/agents/:id/skills', async (request, reply) => {
    const db = getDb()
    const agentId = request.params.id
    const body = request.body

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    if (!body.skill_id || !isValidSkillId(body.skill_id)) {
      return reply.status(400).send({ error: `Invalid skill_id: "${body.skill_id ?? ''}"` })
    }

    const skillConfig = {
      provider_override: body.provider_override ?? null,
      max_tokens_per_call: body.max_tokens_per_call ?? null,
      max_calls_per_hour: body.max_calls_per_hour ?? null,
      timeout_ms: body.timeout_ms ?? null,
    }

    try {
      const [skill] = await db
        .insert(agentSkills)
        .values({
          agent_id: agentId,
          tenant_id: request.tenantId,
          skill_name: body.skill_id,
          skill_config: skillConfig,
          enabled: body.enabled ?? true,
        })
        .returning()
      return reply.status(201).send({ data: skill })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.status(409).send({
          error: `Skill "${body.skill_id}" already exists for this agent. Use PATCH to update.`,
        })
      }
      throw err
    }
  })

  // PATCH /agents/:id/skills/:skill_name — atualiza config parcialmente
  app.patch<{
    Params: { id: string; skill_name: string }
    Body: {
      enabled?: boolean
      provider_override?: { provider: string; model: string } | null
      max_tokens_per_call?: number | null
      max_calls_per_hour?: number | null
      timeout_ms?: number | null
    }
  }>('/agents/:id/skills/:skill_name', async (request, reply) => {
    const db = getDb()
    const { id: agentId, skill_name } = request.params
    const body = request.body

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const current = await db
      .select()
      .from(agentSkills)
      .where(
        and(
          eq(agentSkills.agent_id, agentId),
          eq(agentSkills.skill_name, skill_name),
          eq(agentSkills.tenant_id, request.tenantId),
        ),
      )
      .limit(1)

    if (!current[0]) return reply.status(404).send({ error: 'Skill not found' })

    // Merge: only keys present in body are overwritten in skill_config
    const currentConfig = (current[0].skill_config ?? {}) as Record<string, unknown>
    const patchConfig: Record<string, unknown> = {}
    if ('provider_override' in body) patchConfig['provider_override'] = body.provider_override
    if ('max_tokens_per_call' in body) patchConfig['max_tokens_per_call'] = body.max_tokens_per_call
    if ('max_calls_per_hour' in body) patchConfig['max_calls_per_hour'] = body.max_calls_per_hour
    if ('timeout_ms' in body) patchConfig['timeout_ms'] = body.timeout_ms
    const mergedConfig = { ...currentConfig, ...patchConfig }

    const updateSet: { skill_config: Record<string, unknown>; enabled?: boolean } = {
      skill_config: mergedConfig,
    }
    if (body.enabled !== undefined) updateSet.enabled = body.enabled

    const [updated] = await db
      .update(agentSkills)
      .set(updateSet)
      .where(
        and(
          eq(agentSkills.agent_id, agentId),
          eq(agentSkills.skill_name, skill_name),
          eq(agentSkills.tenant_id, request.tenantId),
        ),
      )
      .returning()

    return { data: updated }
  })

  // DELETE /agents/:id/skills/:skill_name — remove skill
  app.delete<{
    Params: { id: string; skill_name: string }
  }>('/agents/:id/skills/:skill_name', async (request, reply) => {
    const db = getDb()
    const { id: agentId, skill_name } = request.params

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const deleted = await db
      .delete(agentSkills)
      .where(
        and(
          eq(agentSkills.agent_id, agentId),
          eq(agentSkills.skill_name, skill_name),
          eq(agentSkills.tenant_id, request.tenantId),
        ),
      )
      .returning()

    if (deleted.length === 0) return reply.status(404).send({ error: 'Skill not found' })

    return reply.status(204).send()
  })
}
```

- [ ] **Step 2: Registrar em `apps/server/src/app.ts`**

Adicionar após a linha `import { webhookRoutes } from './routes/webhooks'`:
```typescript
import { agentSkillsRoutes } from './routes/agent-skills'
```

Adicionar após `await app.register(agentRoutes, { prefix: '/api/v1' })`:
```typescript
await app.register(agentSkillsRoutes, { prefix: '/api/v1' })
```

- [ ] **Step 3: Adicionar testes E2E em `apps/server/src/__tests__/e2e/agents.test.ts`**

Adicionar ao **final** do arquivo (após o último `})` de fechamento dos describe blocks):

```typescript
// ── E2E: Skills individuais ──────────────────────────────────

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Skills endpoints', () => {
  let app: FastifyInstance
  let token: string
  let agentId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any

  beforeAll(async () => {
    db = await import('@ethra-nexus/db')
    const { buildApp } = await import('../../app')
    app = await buildApp()
    await app.ready()
    token = await app.jwt.sign({ tenantId: TEST_TENANT_ID, email: 'test@test.com', role: 'admin' })
  })

  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Skills Test Agent', slug: 'skills-test', role: 'support' },
    })
    agentId = res.json<{ data: { id: string } }>().data.id
  })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
  })

  it('POST /agents/:id/skills retorna 201 com skill criada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query', enabled: true },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { skill_name: string; enabled: boolean } }>()
    expect(body.data.skill_name).toBe('wiki:query')
    expect(body.data.enabled).toBe(true)
  })

  it('POST /agents/:id/skills retorna 400 para skill_id inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'invalid-skill' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /agents/:id/skills retorna 404 para agente de outro tenant', async () => {
    const otherToken = await app.jwt.sign({ tenantId: '00000000-0000-0000-0000-000000000099', email: 'x@x.com', role: 'admin' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { skill_id: 'wiki:query' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /agents/:id/skills retorna 404 para agente arquivado', async () => {
    await app.inject({ method: 'DELETE', url: `/api/v1/agents/${agentId}`, headers: { authorization: `Bearer ${token}` } })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /agents/:id/skills retorna 409 para skill já existente', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query' },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('PATCH /agents/:id/skills/:skill_name atualiza enabled', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query', enabled: true },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { enabled: boolean } }>()
    expect(body.data.enabled).toBe(false)
  })

  it('PATCH /agents/:id/skills/:skill_name atualiza skill_config parcialmente', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query', max_tokens_per_call: 1000 },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { max_calls_per_hour: 50 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { skill_config: Record<string, unknown> } }>()
    // max_tokens_per_call preserved, max_calls_per_hour added
    expect(body.data.skill_config['max_tokens_per_call']).toBe(1000)
    expect(body.data.skill_config['max_calls_per_hour']).toBe(50)
  })

  it('PATCH /agents/:id/skills/:skill_name retorna 404 para skill inexistente', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /agents/:id/skills/:skill_name remove skill (204)', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query' },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /agents/:id/skills/:skill_name retorna 404 para skill inexistente', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 4: Verificar typecheck**

```bash
cd apps/server && npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 5: Rodar testes (validação unitária passa, E2E skipped sem DATABASE_URL_TEST)**

```bash
cd apps/server && npx vitest run --reporter=verbose
```

Esperado: 15 passed, E2E skipped.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/agent-skills.ts apps/server/src/app.ts apps/server/src/__tests__/e2e/agents.test.ts
git commit -m "feat(server): POST/PATCH/DELETE /agents/:id/skills — gerenciamento individual de skills"
```

---

## Task 2: agent-channels.ts — POST, PATCH, DELETE

**Files:**
- Create: `apps/server/src/routes/agent-channels.ts`
- Modify: `apps/server/src/app.ts` (import + register)
- Modify: `apps/server/src/__tests__/e2e/agents.test.ts` (adicionar describe block)

- [ ] **Step 1: Criar `apps/server/src/routes/agent-channels.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents, agentChannels } from '@ethra-nexus/db'
import { isValidChannelType, validateChannelConfig } from './agents.types'

export async function agentChannelsRoutes(app: FastifyInstance) {
  async function requireAgent(agentId: string, tenantId: string) {
    const db = getDb()
    const rows = await db
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
      .limit(1)
    const agent = rows[0]
    if (!agent || agent.status === 'archived') return null
    return agent
  }

  // POST /agents/:id/channels — cria canal (409 se já existe)
  app.post<{
    Params: { id: string }
    Body: {
      channel_type: string
      enabled?: boolean
      config: Record<string, unknown>
    }
  }>('/agents/:id/channels', async (request, reply) => {
    const db = getDb()
    const agentId = request.params.id
    const { channel_type, enabled, config } = request.body

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    if (!isValidChannelType(channel_type)) {
      return reply.status(400).send({ error: `Invalid channel_type: "${channel_type}"` })
    }
    const configError = validateChannelConfig(channel_type, config ?? {})
    if (configError) return reply.status(400).send({ error: configError })

    try {
      const [channel] = await db
        .insert(agentChannels)
        .values({
          agent_id: agentId,
          tenant_id: request.tenantId,
          channel_type,
          enabled: enabled ?? true,
          config: config ?? {},
        })
        .returning()
      return reply.status(201).send({ data: channel })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.status(409).send({
          error: `Channel type "${channel_type}" already exists for this agent. Use PATCH to update.`,
        })
      }
      throw err
    }
  })

  // PATCH /agents/:id/channels/:channel_type — atualiza config com merge
  app.patch<{
    Params: { id: string; channel_type: string }
    Body: {
      enabled?: boolean
      config?: Record<string, unknown>
    }
  }>('/agents/:id/channels/:channel_type', async (request, reply) => {
    const db = getDb()
    const { id: agentId, channel_type } = request.params
    const body = request.body

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const current = await db
      .select()
      .from(agentChannels)
      .where(
        and(
          eq(agentChannels.agent_id, agentId),
          eq(agentChannels.channel_type, channel_type),
          eq(agentChannels.tenant_id, request.tenantId),
        ),
      )
      .limit(1)

    if (!current[0]) return reply.status(404).send({ error: 'Channel not found' })

    // Merge config: current + patch. Validate merged result to prevent removing required fields.
    const mergedConfig = {
      ...(current[0].config as Record<string, unknown>),
      ...(body.config ?? {}),
    }

    if (body.config !== undefined) {
      const configError = validateChannelConfig(channel_type, mergedConfig)
      if (configError) return reply.status(400).send({ error: configError })
    }

    const updateSet: { config?: Record<string, unknown>; enabled?: boolean; updated_at: Date } = {
      updated_at: new Date(),
    }
    if (body.config !== undefined) updateSet.config = mergedConfig
    if (body.enabled !== undefined) updateSet.enabled = body.enabled

    const [updated] = await db
      .update(agentChannels)
      .set(updateSet)
      .where(
        and(
          eq(agentChannels.agent_id, agentId),
          eq(agentChannels.channel_type, channel_type),
          eq(agentChannels.tenant_id, request.tenantId),
        ),
      )
      .returning()

    return { data: updated }
  })

  // DELETE /agents/:id/channels/:channel_type — remove canal
  app.delete<{
    Params: { id: string; channel_type: string }
  }>('/agents/:id/channels/:channel_type', async (request, reply) => {
    const db = getDb()
    const { id: agentId, channel_type } = request.params

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const deleted = await db
      .delete(agentChannels)
      .where(
        and(
          eq(agentChannels.agent_id, agentId),
          eq(agentChannels.channel_type, channel_type),
          eq(agentChannels.tenant_id, request.tenantId),
        ),
      )
      .returning()

    if (deleted.length === 0) return reply.status(404).send({ error: 'Channel not found' })

    return reply.status(204).send()
  })
}
```

- [ ] **Step 2: Registrar em `apps/server/src/app.ts`**

Adicionar após `import { agentSkillsRoutes } from './routes/agent-skills'`:
```typescript
import { agentChannelsRoutes } from './routes/agent-channels'
```

Adicionar após `await app.register(agentSkillsRoutes, { prefix: '/api/v1' })`:
```typescript
await app.register(agentChannelsRoutes, { prefix: '/api/v1' })
```

- [ ] **Step 3: Adicionar testes E2E em `apps/server/src/__tests__/e2e/agents.test.ts`**

Adicionar ao **final** do arquivo (após o describe block de skills do Task 1):

```typescript
// ── E2E: Canais individuais ──────────────────────────────────

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Channels endpoints', () => {
  let app: FastifyInstance
  let token: string
  let agentId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any

  beforeAll(async () => {
    db = await import('@ethra-nexus/db')
    const { buildApp } = await import('../../app')
    app = await buildApp()
    await app.ready()
    token = await app.jwt.sign({ tenantId: TEST_TENANT_ID, email: 'test@test.com', role: 'admin' })
  })

  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Channels Test Agent', slug: 'channels-test', role: 'support' },
    })
    agentId = res.json<{ data: { id: string } }>().data.id
  })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
  })

  it('POST /agents/:id/channels retorna 201 com canal criado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'whatsapp', config: { evolution_instance: 'nexus-wa' } },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { channel_type: string; enabled: boolean } }>()
    expect(body.data.channel_type).toBe('whatsapp')
    expect(body.data.enabled).toBe(true)
  })

  it('POST /agents/:id/channels retorna 400 para channel_type inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'telegram', config: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /agents/:id/channels retorna 400 para config incompleto (whatsapp sem evolution_instance)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'whatsapp', config: {} },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('evolution_instance')
  })

  it('POST /agents/:id/channels retorna 404 para agente de outro tenant', async () => {
    const otherToken = await app.jwt.sign({ tenantId: '00000000-0000-0000-0000-000000000099', email: 'x@x.com', role: 'admin' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { channel_type: 'webchat', config: {} },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /agents/:id/channels retorna 404 para agente arquivado', async () => {
    await app.inject({ method: 'DELETE', url: `/api/v1/agents/${agentId}`, headers: { authorization: `Bearer ${token}` } })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'webchat', config: {} },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /agents/:id/channels retorna 409 para canal já existente', async () => {
    const payload = { channel_type: 'webchat', config: {} }
    await app.inject({ method: 'POST', url: `/api/v1/agents/${agentId}/channels`, headers: { authorization: `Bearer ${token}` }, payload })
    const res = await app.inject({ method: 'POST', url: `/api/v1/agents/${agentId}/channels`, headers: { authorization: `Bearer ${token}` }, payload })
    expect(res.statusCode).toBe(409)
  })

  it('PATCH /agents/:id/channels/:channel_type atualiza enabled', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'webchat', config: {} },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/channels/webchat`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ data: { enabled: boolean } }>().data.enabled).toBe(false)
  })

  it('PATCH /agents/:id/channels/:channel_type atualiza config parcialmente', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'whatsapp', config: { evolution_instance: 'nexus-wa' } },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/channels/whatsapp`,
      headers: { authorization: `Bearer ${token}` },
      payload: { config: { webhook_url: 'https://meusite.com/hook' } },
    })
    expect(res.statusCode).toBe(200)
    const cfg = res.json<{ data: { config: Record<string, unknown> } }>().data.config
    // evolution_instance preservado, webhook_url adicionado
    expect(cfg['evolution_instance']).toBe('nexus-wa')
    expect(cfg['webhook_url']).toBe('https://meusite.com/hook')
  })

  it('PATCH /agents/:id/channels/:channel_type retorna 404 para canal inexistente', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/channels/webchat`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /agents/:id/channels/:channel_type remove canal (204)', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'webchat', config: {} },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}/channels/webchat`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /agents/:id/channels/:channel_type retorna 404 para canal inexistente', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}/channels/webchat`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 4: Verificar typecheck**

```bash
cd apps/server && npx tsc --noEmit
```

Esperado: zero erros.

- [ ] **Step 5: Rodar testes**

```bash
cd apps/server && npx vitest run --reporter=verbose
```

Esperado: 15 passed, todos os E2E skipped (não há DATABASE_URL_TEST).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/agent-channels.ts apps/server/src/app.ts apps/server/src/__tests__/e2e/agents.test.ts
git commit -m "feat(server): POST/PATCH/DELETE /agents/:id/channels — gerenciamento individual de canais"
```

---

*Plano gerado em 2026-04-21. Spec: docs/superpowers/specs/2026-04-21-fase-21bc-skills-channels-design.md*
