import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { eq, and, asc, desc } from 'drizzle-orm'
import {
  getDb, copilotConversations, copilotMessages, agents,
} from '@ethra-nexus/db'

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

  app.get('/copilot/health', async (request) => {
    return { ok: true, user_email: request.userEmail, role: request.userRole }
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
