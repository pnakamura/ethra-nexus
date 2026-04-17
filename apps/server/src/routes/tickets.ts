import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, tickets } from '@ethra-nexus/db'

export async function ticketRoutes(app: FastifyInstance) {
  // GET /tickets — lista tickets do tenant
  app.get('/tickets', async (request) => {
    const db = getDb()
    const result = await db
      .select()
      .from(tickets)
      .where(eq(tickets.tenant_id, request.tenantId))

    return { data: result }
  })

  // POST /tickets — cria ticket
  app.post<{
    Body: {
      title: string
      agent_id?: string
      goal_id?: string
    }
  }>('/tickets', async (request, reply) => {
    const db = getDb()
    const { title, agent_id, goal_id } = request.body

    if (!title) {
      return reply.status(400).send({ error: 'title is required' })
    }

    const result = await db
      .insert(tickets)
      .values({
        tenant_id: request.tenantId,
        title,
        agent_id: agent_id ?? null,
        goal_id: goal_id ?? null,
      })
      .returning()

    return reply.status(201).send({ data: result[0] })
  })

  // PATCH /tickets/:id/approve — aprova ticket
  app.patch<{ Params: { id: string } }>('/tickets/:id/approve', async (request, reply) => {
    const db = getDb()
    const result = await db
      .update(tickets)
      .set({ status: 'done', updated_at: new Date() })
      .where(
        and(
          eq(tickets.id, request.params.id),
          eq(tickets.tenant_id, request.tenantId),
        ),
      )
      .returning()

    if (result.length === 0) {
      return reply.status(404).send({ error: 'Ticket not found' })
    }

    return { data: result[0] }
  })
}
