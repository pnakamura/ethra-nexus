import type { FastifyInstance } from 'fastify'
import { eq, and, desc } from 'drizzle-orm'
import { getDb, aiosEvents } from '@ethra-nexus/db'
import { executeTask } from '@ethra-nexus/agents'
import type { SkillId } from '@ethra-nexus/core'

export async function aiosRoutes(app: FastifyInstance) {
  // POST /aios/execute — executa uma skill via AIOS Master Orchestrator
  app.post<{
    Body: {
      agent_id: string
      skill_id: string
      input: Record<string, unknown>
      activation_mode?: 'on_demand' | 'scheduled' | 'event'
      activation_source?: string
    }
  }>('/aios/execute', async (request, reply) => {
    const { agent_id, skill_id, input, activation_mode, activation_source } = request.body

    if (!agent_id || !skill_id || !input) {
      return reply.status(400).send({ error: 'agent_id, skill_id, and input are required' })
    }

    const result = await executeTask({
      tenant_id: request.tenantId,
      agent_id,
      skill_id: skill_id as SkillId,
      input,
      activation_mode: activation_mode ?? 'on_demand',
      activation_source,
      user_ip: request.ip,
      user_agent: request.headers['user-agent'] as string | undefined,
    })

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        BUDGET_EXCEEDED: 402,
        AGENT_PAUSED: 403,
        SKILL_NOT_FOUND: 404,
        SKILL_DISABLED: 404,
        AI_ERROR: 502,
      }
      const status = statusMap[result.error.code] ?? 500
      return reply.status(status).send({ error: result.error.message, code: result.error.code })
    }

    return { data: result.data, tokens_used: result.tokens_used, cost_usd: result.cost_usd }
  })

  // GET /aios/events — lista eventos de execução do tenant
  app.get<{
    Querystring: { agent_id?: string; status?: string; limit?: string }
  }>('/aios/events', async (request) => {
    const db = getDb()
    const limit = Math.min(Number(request.query.limit ?? 50), 100)

    const conditions = [eq(aiosEvents.tenant_id, request.tenantId)]
    if (request.query.agent_id) {
      conditions.push(eq(aiosEvents.agent_id, request.query.agent_id))
    }
    if (request.query.status) {
      conditions.push(eq(aiosEvents.status, request.query.status))
    }

    const result = await db
      .select()
      .from(aiosEvents)
      .where(and(...conditions))
      .orderBy(desc(aiosEvents.started_at))
      .limit(limit)

    return { data: result }
  })
}
