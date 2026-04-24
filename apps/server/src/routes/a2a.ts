import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { eq, and, desc } from 'drizzle-orm'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getDb, agents, agentSkills, a2aApiKeys, externalAgents, aiosEvents, tenants } from '@ethra-nexus/db'
import { validateExternalUrl, SecurityValidationError } from '@ethra-nexus/core'
import { AgentCardSchema, executeTask } from '@ethra-nexus/agents'

declare module 'fastify' {
  interface FastifyRequest {
    a2aAgentId?: string
    a2aKeyHash?: string
  }
}

// ── Helpers ──────────────────────────────────────────────────

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  const key = `enx_${raw}`
  const prefix = key.slice(0, 12)
  const hash = hashApiKey(key)
  return { key, prefix, hash }
}

// ── A2A Management Routes (JWT auth — handled by local hook) ─

export async function a2aManagementRoutes(app: FastifyInstance) {
  // All management routes require JWT auth (since /api/v1/a2a is in publicPaths)
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const decoded = await request.jwtVerify<{ tenantId: string }>()
      request.tenantId = decoded.tenantId
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  const db = getDb()

  // POST /a2a/keys — gera nova API key
  app.post<{ Body: { name: string; agent_id: string; expires_at?: string } }>('/a2a/keys', async (request, reply) => {
    const { name, agent_id, expires_at } = request.body
    if (!name || !agent_id) {
      return reply.status(400).send({ error: 'name and agent_id are required' })
    }

    // Verify agent belongs to tenant
    const agentRows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agent_id), eq(agents.tenant_id, request.tenantId)))
      .limit(1)

    if (!agentRows[0]) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    const { key, prefix, hash } = generateApiKey()
    await db.insert(a2aApiKeys).values({
      tenant_id: request.tenantId,
      agent_id,
      name,
      key_hash: hash,
      key_prefix: prefix,
      expires_at: expires_at !== undefined ? new Date(expires_at) : null,
    })

    // Return raw key once — never stored again
    return reply.status(201).send({ data: { key, prefix, name } })
  })

  // GET /a2a/keys — lista API keys do tenant (sem revelar a chave)
  app.get('/a2a/keys', async (request) => {
    const rows = await db
      .select({
        id: a2aApiKeys.id,
        name: a2aApiKeys.name,
        key_prefix: a2aApiKeys.key_prefix,
        agent_id: a2aApiKeys.agent_id,
        expires_at: a2aApiKeys.expires_at,
        last_used_at: a2aApiKeys.last_used_at,
        revoked_at: a2aApiKeys.revoked_at,
        created_at: a2aApiKeys.created_at,
      })
      .from(a2aApiKeys)
      .where(eq(a2aApiKeys.tenant_id, request.tenantId))
    return { data: rows }
  })

  // DELETE /a2a/keys/:id — revoga API key
  app.delete<{ Params: { id: string } }>('/a2a/keys/:id', async (request, reply) => {
    const rows = await db
      .select({ id: a2aApiKeys.id })
      .from(a2aApiKeys)
      .where(and(eq(a2aApiKeys.id, request.params.id), eq(a2aApiKeys.tenant_id, request.tenantId)))
      .limit(1)

    if (!rows[0]) {
      return reply.status(404).send({ error: 'API key not found' })
    }

    await db
      .update(a2aApiKeys)
      .set({ revoked_at: new Date() })
      .where(eq(a2aApiKeys.id, request.params.id))

    return reply.status(204).send()
  })

  // POST /a2a/agents — registra agente externo (descobre + valida Agent Card)
  app.post<{ Body: { url: string; auth_token?: string } }>('/a2a/agents', async (request, reply) => {
    const { url, auth_token } = request.body
    if (!url) {
      return reply.status(400).send({ error: 'url is required' })
    }

    // SSRF check
    try {
      await validateExternalUrl(url)
    } catch (err) {
      if (err instanceof SecurityValidationError) {
        return reply.status(400).send({ error: err.message })
      }
      throw err
    }

    // Fetch Agent Card
    const wellKnownUrl = url.replace(/\/$/, '') + '/.well-known/agent.json'
    let cardData: unknown
    try {
      const res = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        return reply.status(400).send({ error: `Agent Card fetch failed: ${res.status}` })
      }
      cardData = await res.json()
    } catch {
      return reply.status(400).send({ error: `Cannot reach agent at ${url}` })
    }

    // Validate Agent Card schema
    const parsed = AgentCardSchema.safeParse(cardData)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid Agent Card', details: parsed.error.flatten() })
    }

    const card = parsed.data

    // Upsert external agent
    const existing = await db
      .select({ id: externalAgents.id })
      .from(externalAgents)
      .where(and(eq(externalAgents.tenant_id, request.tenantId), eq(externalAgents.url, url)))
      .limit(1)

    let agentId: string
    if (existing[0]) {
      agentId = existing[0].id
      await db
        .update(externalAgents)
        .set({
          name: card.name,
          agent_card: card as Record<string, unknown>,
          auth_token: auth_token ?? null,
          last_checked_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(externalAgents.id, agentId))
    } else {
      const inserted = await db
        .insert(externalAgents)
        .values({
          tenant_id: request.tenantId,
          name: card.name,
          url,
          agent_card: card as Record<string, unknown>,
          auth_token: auth_token ?? null,
          last_checked_at: new Date(),
        })
        .returning({ id: externalAgents.id })
      agentId = inserted[0]!.id
    }

    return reply.status(existing[0] ? 200 : 201).send({ data: { id: agentId, name: card.name, url } })
  })

  // GET /a2a/agents — lista agentes externos do tenant
  app.get('/a2a/agents', async (request) => {
    const rows = await db
      .select({
        id: externalAgents.id,
        name: externalAgents.name,
        url: externalAgents.url,
        status: externalAgents.status,
        agent_card: externalAgents.agent_card,
        last_checked_at: externalAgents.last_checked_at,
        created_at: externalAgents.created_at,
      })
      .from(externalAgents)
      .where(eq(externalAgents.tenant_id, request.tenantId))
    return { data: rows }
  })

  // GET /a2a/agents/:id — detalhe de agente externo
  app.get<{ Params: { id: string } }>('/a2a/agents/:id', async (request, reply) => {
    const rows = await db
      .select()
      .from(externalAgents)
      .where(and(eq(externalAgents.id, request.params.id), eq(externalAgents.tenant_id, request.tenantId)))
      .limit(1)

    if (!rows[0]) {
      return reply.status(404).send({ error: 'External agent not found' })
    }
    return { data: rows[0] }
  })

  // DELETE /a2a/agents/:id — remove agente externo
  app.delete<{ Params: { id: string } }>('/a2a/agents/:id', async (request, reply) => {
    const rows = await db
      .select({ id: externalAgents.id })
      .from(externalAgents)
      .where(and(eq(externalAgents.id, request.params.id), eq(externalAgents.tenant_id, request.tenantId)))
      .limit(1)

    if (!rows[0]) {
      return reply.status(404).send({ error: 'External agent not found' })
    }

    await db
      .delete(externalAgents)
      .where(eq(externalAgents.id, request.params.id))

    return reply.status(204).send()
  })
}

// ── Rate limit state (in-memory, per instance) ───────────────
const rateLimitByKeyHash = new Map<string, { count: number; resetAt: number }>()
const rateLimitByTenantId = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(
  map: Map<string, { count: number; resetAt: number }>,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now()
  let entry = map.get(key)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    map.set(key, entry)
  }
  entry.count++
  return entry.count <= limit
}

export async function a2aProtocolRoutes(app: FastifyInstance) {
  const db = getDb()

  // ── API Key auth hook for all routes in this plugin ──────────
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing API key' })
    }
    const rawKey = authHeader.slice(7)
    const keyHash = hashApiKey(rawKey)

    // Lookup API key
    const keyRows = await db
      .select({
        id: a2aApiKeys.id,
        tenant_id: a2aApiKeys.tenant_id,
        agent_id: a2aApiKeys.agent_id,
        expires_at: a2aApiKeys.expires_at,
        revoked_at: a2aApiKeys.revoked_at,
      })
      .from(a2aApiKeys)
      .where(eq(a2aApiKeys.key_hash, keyHash))
      .limit(1)

    const apiKey = keyRows[0]
    if (!apiKey || apiKey.revoked_at !== null) {
      return reply.status(401).send({ error: 'Invalid or revoked API key' })
    }
    if (apiKey.expires_at !== null && apiKey.expires_at < new Date()) {
      return reply.status(401).send({ error: 'API key expired' })
    }

    // Rate limit by key (after key is confirmed valid)
    if (!checkRateLimit(rateLimitByKeyHash, keyHash, 100, 60_000)) {
      return reply.status(429).send({ error: 'Rate limit exceeded', retryAfter: 60 })
    }

    // Rate limit by tenant
    if (!checkRateLimit(rateLimitByTenantId, apiKey.tenant_id, 500, 3_600_000)) {
      return reply.status(429).send({ error: 'Rate limit exceeded', retryAfter: 3600 })
    }

    // Update last_used_at (fire and forget)
    void db
      .update(a2aApiKeys)
      .set({ last_used_at: new Date() })
      .where(eq(a2aApiKeys.id, apiKey.id))
      .catch(() => undefined)

    request.tenantId = apiKey.tenant_id
    request.a2aAgentId = apiKey.agent_id
    request.a2aKeyHash = keyHash
  })

  // ── POST /a2a — JSON-RPC 2.0 dispatcher ─────────────────────
  app.post<{
    Body: { jsonrpc?: string; id?: unknown; method: string; params?: Record<string, unknown> }
  }>('/a2a', async (request, reply) => {
    const { id: rpcId, method, params = {} } = request.body

    if (method === 'tasks/send') {
      const messageParts = params['message'] as { parts?: Array<{ text?: string }> } | undefined
      const message = messageParts?.parts?.[0]?.text ?? ''
      const contextId = params['contextId'] as string | undefined

      const result = await executeTask({
        tenant_id: request.tenantId,
        agent_id: request.a2aAgentId!,
        skill_id: 'channel:respond',
        input: { message, question: message },
        activation_mode: 'a2a',
        ...(contextId !== undefined && { activation_source: contextId }),
      })

      if (!result.ok) {
        return reply.send({
          jsonrpc: '2.0',
          id: rpcId,
          error: { code: -32603, message: result.error.message },
        })
      }

      // Find the event ID for this execution
      const events = await db
        .select({ id: aiosEvents.id })
        .from(aiosEvents)
        .where(
          and(
            eq(aiosEvents.tenant_id, request.tenantId),
            eq(aiosEvents.agent_id, request.a2aAgentId!),
            eq(aiosEvents.activation_mode, 'a2a'),
          ),
        )
        .orderBy(desc(aiosEvents.started_at))
        .limit(1)

      const taskId = events[0]?.id ?? randomUUID()

      return reply.send({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          id: taskId,
          status: { state: 'submitted' },
        },
      })
    }

    if (method === 'tasks/get') {
      const taskId = params['id'] as string | undefined
      if (!taskId) {
        return reply.send({ jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'id required' } })
      }

      const rows = await db
        .select({ status: aiosEvents.status, result: aiosEvents.result })
        .from(aiosEvents)
        .where(and(eq(aiosEvents.id, taskId), eq(aiosEvents.tenant_id, request.tenantId)))
        .limit(1)

      if (!rows[0]) {
        return reply.send({ jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'Task not found' } })
      }

      const stateMap: Record<string, string> = {
        pending: 'submitted',
        running: 'working',
        ok: 'completed',
        error: 'failed',
        canceled: 'canceled',
      }
      const state = stateMap[rows[0].status] ?? 'unknown'
      const resultText = rows[0].result !== null
        ? String((rows[0].result as Record<string, unknown>)['answer'] ?? '')
        : undefined

      return reply.send({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          id: taskId,
          status: { state },
          ...(resultText !== undefined && { result: resultText }),
        },
      })
    }

    if (method === 'tasks/cancel') {
      const taskId = params['id'] as string | undefined
      if (!taskId) {
        return reply.send({ jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'id required' } })
      }

      const taskRows = await db
        .select({ id: aiosEvents.id })
        .from(aiosEvents)
        .where(and(eq(aiosEvents.id, taskId), eq(aiosEvents.tenant_id, request.tenantId)))
        .limit(1)

      if (!taskRows[0]) {
        return reply.send({ jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'Task not found' } })
      }

      await db
        .update(aiosEvents)
        .set({ status: 'canceled' })
        .where(eq(aiosEvents.id, taskId))

      return reply.send({
        jsonrpc: '2.0',
        id: rpcId,
        result: { id: taskId, status: { state: 'canceled' } },
      })
    }

    return reply.send({
      jsonrpc: '2.0',
      id: rpcId,
      error: { code: -32601, message: 'Method not found' },
    })
  })

  // ── GET /a2a/tasks/:id/events — SSE streaming ────────────────
  app.get<{ Params: { id: string } }>('/a2a/tasks/:id/events', async (request, reply) => {
    const { id: taskId } = request.params

    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders()

    const TERMINAL_STATES = new Set(['ok', 'error', 'canceled'])
    const stateMap: Record<string, string> = {
      pending: 'submitted',
      running: 'working',
      ok: 'completed',
      error: 'failed',
      canceled: 'canceled',
    }
    let lastStatus = ''
    const POLL_MS = 1000
    const TIMEOUT_MS = 5 * 60 * 1000

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const start = Date.now()
    const interval = setInterval(() => {
      void (async () => {
        if (Date.now() - start > TIMEOUT_MS) {
          send('task/timeout', { taskId, message: 'Stream timeout after 5 minutes' })
          clearInterval(interval)
          reply.raw.end()
          return
        }

        const rows = await db
          .select({ status: aiosEvents.status, result: aiosEvents.result })
          .from(aiosEvents)
          .where(and(eq(aiosEvents.id, taskId), eq(aiosEvents.tenant_id, request.tenantId)))
          .limit(1)
          .catch(() => [] as Array<{ status: string; result: unknown }>)

        const row = rows[0]
        if (!row) return

        if (row.status !== lastStatus) {
          lastStatus = row.status
          send('task/updated', {
            taskId,
            status: { state: stateMap[row.status] ?? 'unknown' },
          })

          if (TERMINAL_STATES.has(row.status)) {
            clearInterval(interval)
            reply.raw.end()
          }
        }
      })()
    }, POLL_MS)

    request.raw.on('close', () => {
      clearInterval(interval)
    })

    // Prevent Fastify from sending a response — we handle it via reply.raw
    await new Promise<void>((resolve) => {
      reply.raw.on('finish', resolve)
      reply.raw.on('error', resolve)
    })
  })
}

// ── A2A Public Routes (no auth — Agent Card discovery) ───────

export async function a2aPublicRoutes(app: FastifyInstance) {
  const db = getDb()

  // GET /.well-known/agent.json
  app.get<{ Querystring: { tenant_slug?: string } }>('/.well-known/agent.json', async (request, reply) => {
    const { tenant_slug } = request.query

    let tenantId: string
    if (tenant_slug !== undefined) {
      const tenantRows = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, tenant_slug))
        .limit(1)
      if (!tenantRows[0]) {
        return reply.status(404).send({ error: 'Tenant not found' })
      }
      tenantId = tenantRows[0].id
    } else {
      const allTenants = await db
        .select({ id: tenants.id })
        .from(tenants)
        .limit(2)
      if (allTenants.length === 0) {
        return reply.status(404).send({ error: 'No tenants configured' })
      }
      if (allTenants.length > 1) {
        return reply.status(400).send({ error: 'tenant_slug required for multi-tenant deployments' })
      }
      tenantId = allTenants[0]!.id
    }

    const agentRows = await db
      .select({
        id: agents.id,
        name: agents.name,
        slug: agents.slug,
        description: agents.description,
      })
      .from(agents)
      .where(and(eq(agents.tenant_id, tenantId), eq(agents.a2a_enabled, true)))
      .limit(1)

    if (!agentRows[0]) {
      return reply.status(404).send({ error: 'No public A2A agent configured for this tenant' })
    }

    const agent = agentRows[0]

    const skillRows = await db
      .select({ skill_name: agentSkills.skill_name })
      .from(agentSkills)
      .where(and(eq(agentSkills.agent_id, agent.id), eq(agentSkills.enabled, true)))

    const serverUrl = process.env['PUBLIC_URL'] ?? `http://localhost:${process.env['PORT'] ?? '3000'}`
    const agentCard = {
      name: agent.name,
      description: agent.description ?? `${agent.name} — Ethra Nexus Agent`,
      url: `${serverUrl}/api/v1/a2a`,
      version: '1.0.0',
      skills: skillRows.map((s: { skill_name: string }) => ({
        id: s.skill_name,
        name: s.skill_name,
        description: `Skill: ${s.skill_name}`,
      })),
      capabilities: { streaming: true, pushNotifications: false },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
    }

    return reply.send(agentCard)
  })
}
