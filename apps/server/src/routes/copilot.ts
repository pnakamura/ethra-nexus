import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { eq, and, asc, desc, isNull } from 'drizzle-orm'
import {
  getDb, copilotConversations, copilotMessages, agents, systemAlerts,
} from '@ethra-nexus/db'
import { executeCopilotTurn, generateAutoTitle, AIOS_MASTER_SYSTEM_PROMPT } from '@ethra-nexus/agents'

declare module 'fastify' {
  interface FastifyRequest {
    userSlug?: string
    userRole?: 'admin' | 'member'
  }
}

// Per-conversation lock to block overlapping turns. In-memory; sufficient for single-instance.
const turnLocks = new Set<string>()

// JWT actual shape (auth.ts:37-40): { tenantId, slug, role: 'admin' }.
// No email/sub field. We use slug as the user identity (1 user per tenant
// in current model) and gate on role === 'admin' for the copilot.
async function requireCopilotAccess(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { tenantId?: string; slug?: string; role?: string } | undefined
  if (!user?.slug) return reply.status(401).send({ error: 'Unauthorized' })
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'Copilot is admin-only' })
  }
  request.userSlug = user.slug
  request.userRole = user.role as 'admin' | 'member'
}

export async function copilotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireCopilotAccess)

  app.get('/copilot/health', async (request) => {
    const db = getDb()
    const banner_rows = await db.select({
      id: systemAlerts.id,
      category: systemAlerts.category,
      code: systemAlerts.code,
      severity: systemAlerts.severity,
      message: systemAlerts.message,
      fired_at: systemAlerts.fired_at,
    })
      .from(systemAlerts)
      .where(and(
        eq(systemAlerts.tenant_id, request.tenantId),
        eq(systemAlerts.category, 'storage'),
        eq(systemAlerts.code, 'hard_limit'),
        isNull(systemAlerts.resolved_at),
      ))

    return {
      ok: true,
      user_slug: request.userSlug,
      role: request.userRole,
      banner_alerts: banner_rows,
    }
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
      user_id: request.userSlug!,
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
        eq(copilotConversations.user_id, request.userSlug!),
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
        eq(copilotConversations.user_id, request.userSlug!),
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
          eq(copilotConversations.user_id, request.userSlug!),
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
        eq(copilotConversations.user_id, request.userSlug!),
        eq(copilotConversations.tenant_id, request.tenantId),
      ))
      .returning()
    if (!updated[0]) return reply.status(404).send({ error: 'Not found' })
    return reply.status(204).send()
  })

  // POST /copilot/conversations/:id/messages — SSE turn loop (Task 23)
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
        eq(copilotConversations.user_id, request.userSlug!),
        eq(copilotConversations.tenant_id, request.tenantId),
      ))
      .limit(1)
    const conv = convRows[0]
    if (!conv) return reply.status(404).send({ error: 'Not found' })
    if (conv.status !== 'active') return reply.status(409).send({ error: 'CONVERSATION_ARCHIVED' })
    if (!conv.agent_id) return reply.status(500).send({ error: 'Conversation missing agent_id' })

    // Per-conversation lock
    if (turnLocks.has(id)) return reply.status(409).send({ error: 'TURN_IN_PROGRESS' })
    turnLocks.add(id)

    // Open SSE stream. reply.raw bypasses @fastify/cors so we set headers manually.
    const origin = (request.headers.origin as string | undefined) ?? '*'
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    })

    const sseWrite = (event: { type: string; [k: string]: unknown }) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    const abortController = new AbortController()
    request.raw.on('close', () => abortController.abort())

    // Look up agent system_prompt (fallback to constant if missing)
    const agentRows = await db.select({ system_prompt: agents.system_prompt })
      .from(agents)
      .where(eq(agents.id, conv.agent_id))
      .limit(1)
    const systemPrompt = agentRows[0]?.system_prompt ?? AIOS_MASTER_SYSTEM_PROMPT

    try {
      await executeCopilotTurn({
        conversation_id: id,
        tenant_id: request.tenantId,
        user_id: request.userSlug!,
        user_role: request.userRole!,
        aios_master_agent_id: conv.agent_id,
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
}
