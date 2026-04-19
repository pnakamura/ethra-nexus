import type { FastifyInstance } from 'fastify'
import { eq, and, sql } from 'drizzle-orm'
import { getDb, agents } from '@ethra-nexus/db'
import { embed } from '@ethra-nexus/wiki'
import { createAgentsDb, createRegistryFromEnv } from '@ethra-nexus/agents'

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

  // POST /agents/:id/ask — pergunta ao agente com contexto da wiki
  app.post<{
    Params: { id: string }
    Body: { question: string }
  }>('/agents/:id/ask', async (request, reply) => {
    const { question } = request.body
    if (!question) {
      return reply.status(400).send({ error: 'question is required' })
    }

    const db = getDb()
    const agentRows = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, request.params.id), eq(agents.tenant_id, request.tenantId)))
      .limit(1)

    const agent = agentRows[0]
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    // Budget check
    const month = new Date().toISOString().slice(0, 7)
    const agentsDb = createAgentsDb()
    const budgetCheck = await agentsDb.canExecute(agent.id, month, 0.02)
    if (!budgetCheck.allowed) {
      return reply.status(402).send({ error: 'Budget exceeded', reason: budgetCheck.reason })
    }

    // Semantic wiki search for context
    let wikiContext = ''
    try {
      const queryEmbedding = await embed(question)
      const vectorStr = `[${queryEmbedding.join(',')}]`
      const searchResult = await db.execute(
        sql`SELECT title, content
            FROM wiki_strategic_pages
            WHERE tenant_id = ${request.tenantId}
              AND status = 'ativo'
              AND embedding IS NOT NULL
              AND 1 - (embedding <=> ${vectorStr}::vector) > 0.3
            ORDER BY embedding <=> ${vectorStr}::vector
            LIMIT 3`,
      )
      const pages = searchResult.rows as Array<{ title: string; content: string }>
      if (pages.length > 0) {
        wikiContext = pages.map((p) => `## ${p.title}\n${p.content}`).join('\n\n---\n\n')
      }
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, 'wiki search for ask failed')
    }

    const systemPrompt =
      (agent.system_prompt || 'Você é um assistente de IA. Responda em português de forma clara e objetiva.') +
      (wikiContext ? `\n\n## Base de conhecimento:\n${wikiContext}` : '')

    let registry
    try {
      registry = createRegistryFromEnv()
    } catch (err) {
      return reply.status(503).send({ error: 'AI provider not configured', details: (err as Error).message })
    }

    const start = Date.now()
    let result
    try {
      result = await registry.complete('channel:respond', {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        max_tokens: 1000,
        sensitive_data: true,
      })
    } catch (err) {
      request.log.error({ err: (err as Error).message }, 'LLM completion failed for agent ask')
      return reply.status(502).send({ error: 'LLM unavailable', details: (err as Error).message })
    }

    const latencyMs = Date.now() - start
    const totalTokens = result.input_tokens + result.output_tokens
    const costUsd = result.estimated_cost_usd ?? 0

    await agentsDb.logProviderUsage({
      tenant_id: request.tenantId,
      agent_id: agent.id,
      skill_id: 'channel:respond',
      provider: result.provider,
      model: result.model,
      tokens_in: result.input_tokens,
      tokens_out: result.output_tokens,
      cost_usd: costUsd,
      latency_ms: latencyMs,
      is_fallback: result.is_fallback,
      is_sensitive: true,
    })

    await agentsDb.upsertBudget(agent.id, request.tenantId, month, costUsd, totalTokens)

    return {
      answer: result.content,
      tokens_used: totalTokens,
      cost_usd: costUsd,
      provider: result.provider,
      model: result.model,
    }
  })
}
