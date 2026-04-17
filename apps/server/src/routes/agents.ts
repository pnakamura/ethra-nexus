import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents } from '@ethra-nexus/db'

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
}
