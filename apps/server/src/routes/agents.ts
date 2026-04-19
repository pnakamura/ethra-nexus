import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents } from '@ethra-nexus/db'
import { executeTask } from '@ethra-nexus/agents'

export async function agentRoutes(app: FastifyInstance) {
  // GET /agents — lista agentes do tenant
  app.get('/agents', async (request) => {
    const db = getDb()
    const result = await db
      .select()
      .from(agents)
      .where(eq(agents.tenant_id, request.tenantId))

    return { data: result }
  })

  // GET /agents/:id — detalhe de um agente
  app.get<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    const db = getDb()
    const result = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.id, request.params.id),
          eq(agents.tenant_id, request.tenantId),
        ),
      )
      .limit(1)

    const agent = result[0]
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    return { data: agent }
  })

  // POST /agents — cria agente
  app.post<{
    Body: {
      name: string
      slug: string
      role: string
      model?: string
      system_prompt?: string
      budget_monthly?: string
    }
  }>('/agents', async (request, reply) => {
    const db = getDb()
    const { name, slug, role, model, system_prompt, budget_monthly } = request.body

    if (!name || !slug || !role) {
      return reply.status(400).send({ error: 'name, slug, and role are required' })
    }

    const result = await db
      .insert(agents)
      .values({
        tenant_id: request.tenantId,
        name,
        slug,
        role,
        model: model ?? 'claude-sonnet-4-6',
        system_prompt: system_prompt ?? '',
        budget_monthly: budget_monthly ?? '50.00',
      })
      .returning()

    return reply.status(201).send({ data: result[0] })
  })

  // POST /agents/:id/ask — pergunta ao agente (delega ao AIOS Master)
  app.post<{
    Params: { id: string }
    Body: { question: string }
  }>('/agents/:id/ask', async (request, reply) => {
    const { question } = request.body
    if (!question) {
      return reply.status(400).send({ error: 'question is required' })
    }

    const result = await executeTask({
      tenant_id: request.tenantId,
      agent_id: request.params.id,
      skill_id: 'wiki:query',
      input: { question },
      activation_mode: 'on_demand',
      activation_source: 'api',
      user_ip: request.ip,
      user_agent: request.headers['user-agent'] as string | undefined,
    })

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        BUDGET_EXCEEDED: 402,
        AGENT_PAUSED: 403,
        SKILL_NOT_FOUND: 404,
      }
      const status = statusMap[result.error.code] ?? 502
      return reply.status(status).send({ error: result.error.message })
    }

    return {
      answer: result.data.answer,
      tokens_used: result.tokens_used,
      cost_usd: result.cost_usd,
      provider: result.data.provider,
      model: result.data.model,
    }
  })
}
