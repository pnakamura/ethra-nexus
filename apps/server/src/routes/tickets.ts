import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, tickets } from '@ethra-nexus/db'

export async function ticketRoutes(app: FastifyInstance) {
  // GET /tickets — lista tickets do tenant (filtrável por status)
  app.get<{ Querystring: { status?: string } }>('/tickets', async (request) => {
    const db = getDb()
    const { status } = request.query

    const whereClause = status
      ? and(eq(tickets.tenant_id, request.tenantId), eq(tickets.status, status))
      : eq(tickets.tenant_id, request.tenantId)

    const result = await db.select().from(tickets).where(whereClause)
    return { data: result }
  })

  // GET /tickets/:id — detalhe de um ticket
  app.get<{ Params: { id: string } }>('/tickets/:id', async (request, reply) => {
    const db = getDb()
    const result = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, request.params.id), eq(tickets.tenant_id, request.tenantId)))
      .limit(1)

    if (!result[0]) return reply.status(404).send({ error: 'Ticket not found' })
    return { data: result[0] }
  })

  // POST /tickets — cria ticket
  app.post<{
    Body: {
      title: string
      description?: string
      agent_id?: string
      goal_id?: string
    }
  }>('/tickets', async (request, reply) => {
    const db = getDb()
    const { title, description, agent_id, goal_id } = request.body

    if (!title) {
      return reply.status(400).send({ error: 'title is required' })
    }

    const result = await db
      .insert(tickets)
      .values({
        tenant_id: request.tenantId,
        title,
        description: description ?? null,
        agent_id: agent_id ?? null,
        goal_id: goal_id ?? null,
      })
      .returning()

    return reply.status(201).send({ data: result[0] })
  })

  // PATCH /tickets/:id — edita título/descrição
  app.patch<{
    Params: { id: string }
    Body: { title?: string; description?: string | null }
  }>('/tickets/:id', async (request, reply) => {
    const { title, description } = request.body
    if (!title && description === undefined) {
      return reply.status(400).send({ error: 'title or description required' })
    }

    const db = getDb()
    const setValues: { updated_at: Date; title?: string; description?: string | null } = {
      updated_at: new Date(),
    }
    if (title) setValues.title = title
    if (description !== undefined) setValues.description = description ?? null

    const result = await db
      .update(tickets)
      .set(setValues)
      .where(and(eq(tickets.id, request.params.id), eq(tickets.tenant_id, request.tenantId)))
      .returning()

    if (!result[0]) return reply.status(404).send({ error: 'Ticket not found' })
    return { data: result[0] }
  })

  // PATCH /tickets/:id/approve — aprova ticket
  app.patch<{ Params: { id: string } }>('/tickets/:id/approve', async (request, reply) => {
    const db = getDb()
    const result = await db
      .update(tickets)
      .set({ status: 'approved', updated_at: new Date() })
      .where(and(eq(tickets.id, request.params.id), eq(tickets.tenant_id, request.tenantId)))
      .returning()

    if (!result[0]) return reply.status(404).send({ error: 'Ticket not found' })
    return { data: result[0] }
  })

  // POST /tickets/:id/reject — rejeita ticket com motivo
  app.post<{
    Params: { id: string }
    Body: { rejection_reason?: string }
  }>('/tickets/:id/reject', async (request, reply) => {
    const db = getDb()
    const result = await db
      .update(tickets)
      .set({
        status: 'rejected',
        rejection_reason: request.body?.rejection_reason ?? null,
        updated_at: new Date(),
      })
      .where(and(eq(tickets.id, request.params.id), eq(tickets.tenant_id, request.tenantId)))
      .returning()

    if (!result[0]) return reply.status(404).send({ error: 'Ticket not found' })
    return { data: result[0] }
  })
}
