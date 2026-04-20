import type { FastifyInstance } from 'fastify'
import { eq, and, desc } from 'drizzle-orm'
import { getDb, agentSchedules, scheduledResults } from '@ethra-nexus/db'
import { validateCron, calcNextRun } from '@ethra-nexus/agents'

const VALID_CHANNELS = ['api', 'whatsapp', 'both'] as const

export async function schedulesRoutes(app: FastifyInstance) {
  // POST /schedules
  app.post<{
    Body: {
      agent_id: string
      skill_id: string
      cron_expression: string
      timezone?: string
      input?: Record<string, unknown>
      output_channel?: string
    }
  }>('/schedules', async (request, reply) => {
    const db = getDb()
    const {
      agent_id, skill_id, cron_expression,
      timezone = 'UTC', input = {}, output_channel = 'api',
    } = request.body

    if (!agent_id || !skill_id || !cron_expression) {
      return reply.status(400).send({ error: 'agent_id, skill_id, and cron_expression are required' })
    }
    if (!validateCron(cron_expression)) {
      return reply.status(400).send({ error: 'Invalid cron_expression' })
    }
    if (!VALID_CHANNELS.includes(output_channel as typeof VALID_CHANNELS[number])) {
      return reply.status(400).send({ error: 'output_channel must be api, whatsapp, or both' })
    }

    const result = await db.insert(agentSchedules).values({
      tenant_id: request.tenantId,
      agent_id,
      skill_id,
      cron_expression,
      timezone,
      input,
      output_channel,
      next_run_at: calcNextRun(cron_expression, timezone),
    }).returning()

    return reply.status(201).send({ data: result[0] })
  })

  // GET /schedules
  app.get<{ Querystring: { agent_id?: string } }>('/schedules', async (request) => {
    const db = getDb()
    const conditions = [eq(agentSchedules.tenant_id, request.tenantId)]
    if (request.query.agent_id) conditions.push(eq(agentSchedules.agent_id, request.query.agent_id))
    const result = await db.select().from(agentSchedules).where(and(...conditions))
    return { data: result }
  })

  // GET /schedules/:id
  app.get<{ Params: { id: string } }>('/schedules/:id', async (request, reply) => {
    const db = getDb()
    const result = await db.select().from(agentSchedules)
      .where(and(eq(agentSchedules.id, request.params.id), eq(agentSchedules.tenant_id, request.tenantId)))
      .limit(1)
    if (!result[0]) return reply.status(404).send({ error: 'Schedule not found' })
    return { data: result[0] }
  })

  // PATCH /schedules/:id
  app.patch<{
    Params: { id: string }
    Body: {
      skill_id?: string
      cron_expression?: string
      timezone?: string
      input?: Record<string, unknown>
      output_channel?: string
    }
  }>('/schedules/:id', async (request, reply) => {
    const db = getDb()
    const { cron_expression, timezone, skill_id, input, output_channel } = request.body

    if (cron_expression !== undefined && !validateCron(cron_expression)) {
      return reply.status(400).send({ error: 'Invalid cron_expression' })
    }
    if (output_channel !== undefined && !VALID_CHANNELS.includes(output_channel as typeof VALID_CHANNELS[number])) {
      return reply.status(400).send({ error: 'output_channel must be api, whatsapp, or both' })
    }

    type ScheduleSet = Partial<typeof agentSchedules.$inferInsert>
    const setValues: ScheduleSet = { updated_at: new Date() }
    if (skill_id !== undefined) setValues.skill_id = skill_id
    if (input !== undefined) setValues.input = input
    if (output_channel !== undefined) setValues.output_channel = output_channel
    if (cron_expression !== undefined) {
      setValues.cron_expression = cron_expression
      setValues.timezone = timezone ?? 'UTC'
      setValues.next_run_at = calcNextRun(cron_expression, timezone ?? 'UTC')
    }

    const result = await db.update(agentSchedules).set(setValues)
      .where(and(eq(agentSchedules.id, request.params.id), eq(agentSchedules.tenant_id, request.tenantId)))
      .returning()
    if (!result[0]) return reply.status(404).send({ error: 'Schedule not found' })
    return { data: result[0] }
  })

  // DELETE /schedules/:id
  app.delete<{ Params: { id: string } }>('/schedules/:id', async (request, reply) => {
    const db = getDb()
    const result = await db.delete(agentSchedules)
      .where(and(eq(agentSchedules.id, request.params.id), eq(agentSchedules.tenant_id, request.tenantId)))
      .returning()
    if (!result[0]) return reply.status(404).send({ error: 'Schedule not found' })
    return reply.status(204).send()
  })

  // PATCH /schedules/:id/enable
  app.patch<{ Params: { id: string } }>('/schedules/:id/enable', async (request, reply) => {
    const db = getDb()
    const result = await db.update(agentSchedules)
      .set({ enabled: true, updated_at: new Date() })
      .where(and(eq(agentSchedules.id, request.params.id), eq(agentSchedules.tenant_id, request.tenantId)))
      .returning()
    if (!result[0]) return reply.status(404).send({ error: 'Schedule not found' })
    return { data: result[0] }
  })

  // PATCH /schedules/:id/disable
  app.patch<{ Params: { id: string } }>('/schedules/:id/disable', async (request, reply) => {
    const db = getDb()
    const result = await db.update(agentSchedules)
      .set({ enabled: false, updated_at: new Date() })
      .where(and(eq(agentSchedules.id, request.params.id), eq(agentSchedules.tenant_id, request.tenantId)))
      .returning()
    if (!result[0]) return reply.status(404).send({ error: 'Schedule not found' })
    return { data: result[0] }
  })

  // GET /schedules/:id/results
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string }
  }>('/schedules/:id/results', async (request, reply) => {
    const db = getDb()
    const limit = Math.min(Number(request.query.limit ?? 20), 100)

    const schedule = await db.select({ id: agentSchedules.id }).from(agentSchedules)
      .where(and(eq(agentSchedules.id, request.params.id), eq(agentSchedules.tenant_id, request.tenantId)))
      .limit(1)
    if (!schedule[0]) return reply.status(404).send({ error: 'Schedule not found' })

    const results = await db.select().from(scheduledResults)
      .where(and(
        eq(scheduledResults.schedule_id, request.params.id),
        eq(scheduledResults.tenant_id, request.tenantId),
      ))
      .orderBy(desc(scheduledResults.triggered_at))
      .limit(limit)

    return { data: results }
  })
}
