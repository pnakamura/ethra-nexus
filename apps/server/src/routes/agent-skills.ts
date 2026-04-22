import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents, agentSkills } from '@ethra-nexus/db'
import { isValidSkillId } from './agents.types'

export async function agentSkillsRoutes(app: FastifyInstance) {
  async function requireAgent(agentId: string, tenantId: string) {
    const db = getDb()
    const rows = await db
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
      .limit(1)
    const agent = rows[0]
    if (!agent || agent.status === 'archived') return null
    return agent
  }

  // POST /agents/:id/skills — cria skill (409 se já existe)
  app.post<{
    Params: { id: string }
    Body: {
      skill_id: string
      enabled?: boolean
      provider_override?: { provider: string; model: string }
      max_tokens_per_call?: number
      max_calls_per_hour?: number
      timeout_ms?: number
    }
  }>('/agents/:id/skills', async (request, reply) => {
    const db = getDb()
    const agentId = request.params.id
    const body = request.body

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    if (!body.skill_id || !isValidSkillId(body.skill_id)) {
      return reply.status(400).send({ error: `Invalid skill_id: "${body.skill_id ?? ''}"` })
    }

    const skillConfig = {
      provider_override: body.provider_override ?? null,
      max_tokens_per_call: body.max_tokens_per_call ?? null,
      max_calls_per_hour: body.max_calls_per_hour ?? null,
      timeout_ms: body.timeout_ms ?? null,
    }

    try {
      const [skill] = await db
        .insert(agentSkills)
        .values({
          agent_id: agentId,
          tenant_id: request.tenantId,
          skill_name: body.skill_id,
          skill_config: skillConfig,
          enabled: body.enabled ?? true,
        })
        .returning()
      return reply.status(201).send({ data: skill })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.status(409).send({
          error: `Skill "${body.skill_id}" already exists for this agent. Use PATCH to update.`,
        })
      }
      throw err
    }
  })

  // PATCH /agents/:id/skills/:skill_name — atualiza config parcialmente
  app.patch<{
    Params: { id: string; skill_name: string }
    Body: {
      enabled?: boolean
      provider_override?: { provider: string; model: string } | null
      max_tokens_per_call?: number | null
      max_calls_per_hour?: number | null
      timeout_ms?: number | null
    }
  }>('/agents/:id/skills/:skill_name', async (request, reply) => {
    const db = getDb()
    const { id: agentId, skill_name } = request.params
    const body = request.body

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const current = await db
      .select()
      .from(agentSkills)
      .where(
        and(
          eq(agentSkills.agent_id, agentId),
          eq(agentSkills.skill_name, skill_name),
          eq(agentSkills.tenant_id, request.tenantId),
        ),
      )
      .limit(1)

    if (!current[0]) return reply.status(404).send({ error: 'Skill not found' })

    // Merge: only keys present in body are overwritten in skill_config
    const currentConfig = (current[0].skill_config ?? {}) as Record<string, unknown>
    const patchConfig: Record<string, unknown> = {}
    if ('provider_override' in body) patchConfig['provider_override'] = body.provider_override
    if ('max_tokens_per_call' in body) patchConfig['max_tokens_per_call'] = body.max_tokens_per_call
    if ('max_calls_per_hour' in body) patchConfig['max_calls_per_hour'] = body.max_calls_per_hour
    if ('timeout_ms' in body) patchConfig['timeout_ms'] = body.timeout_ms
    const mergedConfig = { ...currentConfig, ...patchConfig }

    const updateSet: { skill_config: Record<string, unknown>; enabled?: boolean } = {
      skill_config: mergedConfig,
    }
    if (body.enabled !== undefined) updateSet.enabled = body.enabled

    const [updated] = await db
      .update(agentSkills)
      .set(updateSet)
      .where(
        and(
          eq(agentSkills.agent_id, agentId),
          eq(agentSkills.skill_name, skill_name),
          eq(agentSkills.tenant_id, request.tenantId),
        ),
      )
      .returning()

    return { data: updated }
  })

  // DELETE /agents/:id/skills/:skill_name — remove skill
  app.delete<{
    Params: { id: string; skill_name: string }
  }>('/agents/:id/skills/:skill_name', async (request, reply) => {
    const db = getDb()
    const { id: agentId, skill_name } = request.params

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const deleted = await db
      .delete(agentSkills)
      .where(
        and(
          eq(agentSkills.agent_id, agentId),
          eq(agentSkills.skill_name, skill_name),
          eq(agentSkills.tenant_id, request.tenantId),
        ),
      )
      .returning()

    if (deleted.length === 0) return reply.status(404).send({ error: 'Skill not found' })

    return reply.status(204).send()
  })
}
