import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agentEventSubscriptions } from '@ethra-nexus/db'

const VALID_EVENT_TYPES = ['budget_alert', 'wiki_ingested', 'webhook'] as const
const VALID_CHANNELS = ['api', 'whatsapp', 'both'] as const

export async function eventSubscriptionsRoutes(app: FastifyInstance) {
  // POST /event-subscriptions
  app.post<{
    Body: {
      agent_id: string
      event_type: string
      event_filter?: Record<string, unknown>
      skill_id: string
      input?: Record<string, unknown>
      output_channel?: string
    }
  }>('/event-subscriptions', async (request, reply) => {
    const db = getDb()
    const {
      agent_id, event_type, event_filter = {},
      skill_id, input = {}, output_channel = 'api',
    } = request.body

    if (!agent_id || !event_type || !skill_id) {
      return reply.status(400).send({ error: 'agent_id, event_type, and skill_id are required' })
    }
    if (!VALID_EVENT_TYPES.includes(event_type as typeof VALID_EVENT_TYPES[number])) {
      return reply.status(400).send({ error: `event_type must be one of: ${VALID_EVENT_TYPES.join(', ')}` })
    }
    if (!VALID_CHANNELS.includes(output_channel as typeof VALID_CHANNELS[number])) {
      return reply.status(400).send({ error: 'output_channel must be api, whatsapp, or both' })
    }

    const result = await db.insert(agentEventSubscriptions).values({
      tenant_id: request.tenantId,
      agent_id,
      event_type,
      event_filter,
      skill_id,
      input,
      output_channel,
    }).returning()

    return reply.status(201).send({ data: result[0] })
  })

  // GET /event-subscriptions
  app.get<{ Querystring: { agent_id?: string } }>('/event-subscriptions', async (request) => {
    const db = getDb()
    const conditions = [eq(agentEventSubscriptions.tenant_id, request.tenantId)]
    if (request.query.agent_id) conditions.push(eq(agentEventSubscriptions.agent_id, request.query.agent_id))
    const result = await db.select().from(agentEventSubscriptions).where(and(...conditions))
    return { data: result }
  })

  // PATCH /event-subscriptions/:id
  app.patch<{
    Params: { id: string }
    Body: {
      event_filter?: Record<string, unknown>
      skill_id?: string
      input?: Record<string, unknown>
      output_channel?: string
    }
  }>('/event-subscriptions/:id', async (request, reply) => {
    const db = getDb()
    type SubSet = Partial<typeof agentEventSubscriptions.$inferInsert>
    const setValues: SubSet = { updated_at: new Date() }
    const { event_filter, skill_id, input, output_channel } = request.body
    if (event_filter !== undefined) setValues.event_filter = event_filter
    if (skill_id !== undefined) setValues.skill_id = skill_id
    if (input !== undefined) setValues.input = input
    if (output_channel !== undefined) setValues.output_channel = output_channel

    const result = await db.update(agentEventSubscriptions).set(setValues)
      .where(and(eq(agentEventSubscriptions.id, request.params.id), eq(agentEventSubscriptions.tenant_id, request.tenantId)))
      .returning()
    if (!result[0]) return reply.status(404).send({ error: 'Subscription not found' })
    return { data: result[0] }
  })

  // DELETE /event-subscriptions/:id
  app.delete<{ Params: { id: string } }>('/event-subscriptions/:id', async (request, reply) => {
    const db = getDb()
    const result = await db.delete(agentEventSubscriptions)
      .where(and(eq(agentEventSubscriptions.id, request.params.id), eq(agentEventSubscriptions.tenant_id, request.tenantId)))
      .returning()
    if (!result[0]) return reply.status(404).send({ error: 'Subscription not found' })
    return reply.status(204).send()
  })

  // PATCH /event-subscriptions/:id/enable
  app.patch<{ Params: { id: string } }>('/event-subscriptions/:id/enable', async (request, reply) => {
    const db = getDb()
    const result = await db.update(agentEventSubscriptions)
      .set({ enabled: true, updated_at: new Date() })
      .where(and(eq(agentEventSubscriptions.id, request.params.id), eq(agentEventSubscriptions.tenant_id, request.tenantId)))
      .returning()
    if (!result[0]) return reply.status(404).send({ error: 'Subscription not found' })
    return { data: result[0] }
  })

  // PATCH /event-subscriptions/:id/disable
  app.patch<{ Params: { id: string } }>('/event-subscriptions/:id/disable', async (request, reply) => {
    const db = getDb()
    const result = await db.update(agentEventSubscriptions)
      .set({ enabled: false, updated_at: new Date() })
      .where(and(eq(agentEventSubscriptions.id, request.params.id), eq(agentEventSubscriptions.tenant_id, request.tenantId)))
      .returning()
    if (!result[0]) return reply.status(404).send({ error: 'Subscription not found' })
    return { data: result[0] }
  })
}
