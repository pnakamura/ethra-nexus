import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents, agentSkills, agentChannels } from '@ethra-nexus/db'
import { executeTask, createAgentsDb } from '@ethra-nexus/agents'
import { validateSlug, SecurityValidationError } from '@ethra-nexus/core'
import {
  isValidSkillId,
  isValidChannelType,
  isValidTone,
  validateChannelConfig,
  type SkillInput,
  type ChannelInput,
} from './agents.types'

export async function agentRoutes(app: FastifyInstance) {
  const agentsDb = createAgentsDb()

  // GET /agents — lista agentes do tenant (sem arquivados, com skills e canais)
  app.get('/agents', async (request) => {
    const data = await agentsDb.loadAgentsWithDetails(request.tenantId)
    return { data }
  })

  // GET /agents/:id — detalhe de um agente (com skills e canais)
  app.get<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    const agent = await agentsDb.loadAgentWithDetails(request.params.id, request.tenantId)

    if (!agent || agent.status === 'archived') {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    return { data: agent }
  })

  // POST /agents — cria agente com identidade completa + skills + canais
  app.post<{
    Body: {
      name: string
      slug: string
      role: string
      model?: string
      system_prompt?: string
      system_prompt_extra?: string
      response_language?: string
      tone?: string
      restrictions?: string[]
      description?: string
      avatar_url?: string
      tags?: string[]
      budget_monthly?: string
      skills?: SkillInput[]
      channels?: ChannelInput[]
    }
  }>('/agents', async (request, reply) => {
    const db = getDb()
    const {
      name, slug, role,
      model, system_prompt, system_prompt_extra,
      response_language, tone, restrictions,
      description, avatar_url, tags,
      budget_monthly, skills = [], channels = [],
    } = request.body

    if (!name || !slug || !role) {
      return reply.status(400).send({ error: 'name, slug, and role are required' })
    }

    try {
      validateSlug(slug)
    } catch (err) {
      return reply.status(400).send({ error: err instanceof SecurityValidationError ? err.message : 'Invalid slug' })
    }

    if (tone !== undefined && !isValidTone(tone)) {
      return reply.status(400).send({ error: `Invalid tone: "${tone}". Must be one of: formal, professional, friendly, technical, custom` })
    }

    for (const skill of skills) {
      if (!isValidSkillId(skill.skill_id)) {
        return reply.status(400).send({ error: `Invalid skill_id: "${skill.skill_id}"` })
      }
    }

    for (const channel of channels) {
      if (!isValidChannelType(channel.channel_type)) {
        return reply.status(400).send({ error: `Invalid channel_type: "${channel.channel_type}"` })
      }
      const configError = validateChannelConfig(channel.channel_type, channel.config)
      if (configError) {
        return reply.status(400).send({ error: configError })
      }
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [agent] = await tx.insert(agents).values({
          tenant_id: request.tenantId,
          name,
          slug,
          role,
          model: model ?? 'claude-sonnet-4-6',
          system_prompt: system_prompt ?? '',
          system_prompt_extra: system_prompt_extra ?? null,
          response_language: response_language ?? 'pt-BR',
          tone: tone ?? 'professional',
          restrictions: restrictions ?? [],
          description: description ?? null,
          avatar_url: avatar_url ?? null,
          tags: tags ?? [],
          budget_monthly: budget_monthly ?? '50.00',
        }).returning()

        if (!agent) throw new Error('Failed to create agent')

        if (skills.length > 0) {
          await tx.insert(agentSkills).values(
            skills.map((skill) => ({
              agent_id: agent.id,
              tenant_id: request.tenantId,
              skill_name: skill.skill_id,
              skill_config: {
                provider_override: skill.provider_override ?? null,
                max_tokens_per_call: skill.max_tokens_per_call ?? null,
                max_calls_per_hour: skill.max_calls_per_hour ?? null,
                timeout_ms: skill.timeout_ms ?? null,
              },
              enabled: skill.enabled ?? true,
            })),
          )
        }

        if (channels.length > 0) {
          await tx.insert(agentChannels).values(
            channels.map((channel) => ({
              agent_id: agent.id,
              tenant_id: request.tenantId,
              channel_type: channel.channel_type,
              enabled: channel.enabled ?? true,
              config: channel.config,
            })),
          )
        }

        const [savedSkills, savedChannels] = await Promise.all([
          tx.select().from(agentSkills).where(eq(agentSkills.agent_id, agent.id)),
          tx.select().from(agentChannels).where(eq(agentChannels.agent_id, agent.id)),
        ])

        return { ...agent, skills: savedSkills, channels: savedChannels }
      })

      return reply.status(201).send({ data: result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.status(409).send({ error: `Agent with slug "${slug}" already exists for this tenant` })
      }
      throw err
    }
  })

  // PATCH /agents/:id — atualização parcial de agente
  app.patch<{
    Params: { id: string }
    Body: {
      name?: string
      model?: string
      system_prompt?: string
      system_prompt_extra?: string
      response_language?: string
      tone?: string
      restrictions?: string[]
      description?: string
      avatar_url?: string
      tags?: string[]
      budget_monthly?: string
      status?: string
      skills?: SkillInput[]
      channels?: ChannelInput[]
    }
  }>('/agents/:id', async (request, reply) => {
    const db = getDb()
    const agentId = request.params.id
    const body = request.body

    const existing = await agentsDb.loadAgentWithDetails(agentId, request.tenantId)
    if (!existing || existing.status === 'archived') {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (body.tone !== undefined && !isValidTone(body.tone)) {
      return reply.status(400).send({ error: `Invalid tone: "${body.tone}"` })
    }

    for (const skill of body.skills ?? []) {
      if (!isValidSkillId(skill.skill_id)) {
        return reply.status(400).send({ error: `Invalid skill_id: "${skill.skill_id}"` })
      }
    }

    for (const channel of body.channels ?? []) {
      if (!isValidChannelType(channel.channel_type)) {
        return reply.status(400).send({ error: `Invalid channel_type: "${channel.channel_type}"` })
      }
      const configError = validateChannelConfig(channel.channel_type, channel.config)
      if (configError) {
        return reply.status(400).send({ error: configError })
      }
    }

    const result = await db.transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentUpdate: Record<string, any> = { updated_at: new Date() }
      if (body.name !== undefined) agentUpdate['name'] = body.name
      if (body.model !== undefined) agentUpdate['model'] = body.model
      if (body.system_prompt !== undefined) agentUpdate['system_prompt'] = body.system_prompt
      if (body.system_prompt_extra !== undefined) agentUpdate['system_prompt_extra'] = body.system_prompt_extra
      if (body.response_language !== undefined) agentUpdate['response_language'] = body.response_language
      if (body.tone !== undefined) agentUpdate['tone'] = body.tone
      if (body.restrictions !== undefined) agentUpdate['restrictions'] = body.restrictions
      if (body.description !== undefined) agentUpdate['description'] = body.description
      if (body.avatar_url !== undefined) agentUpdate['avatar_url'] = body.avatar_url
      if (body.tags !== undefined) agentUpdate['tags'] = body.tags
      if (body.budget_monthly !== undefined) agentUpdate['budget_monthly'] = body.budget_monthly
      if (body.status !== undefined) agentUpdate['status'] = body.status

      await tx.update(agents)
        .set(agentUpdate)
        .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))

      for (const skill of body.skills ?? []) {
        const skillConfig = {
          provider_override: skill.provider_override ?? null,
          max_tokens_per_call: skill.max_tokens_per_call ?? null,
          max_calls_per_hour: skill.max_calls_per_hour ?? null,
          timeout_ms: skill.timeout_ms ?? null,
        }
        await tx.insert(agentSkills)
          .values({
            agent_id: agentId,
            tenant_id: request.tenantId,
            skill_name: skill.skill_id,
            skill_config: skillConfig,
            enabled: skill.enabled ?? true,
          })
          .onConflictDoUpdate({
            target: [agentSkills.agent_id, agentSkills.skill_name],
            set: { skill_config: skillConfig, enabled: skill.enabled ?? true },
          })
      }

      for (const channel of body.channels ?? []) {
        await tx.insert(agentChannels)
          .values({
            agent_id: agentId,
            tenant_id: request.tenantId,
            channel_type: channel.channel_type,
            enabled: channel.enabled ?? true,
            config: channel.config,
          })
          .onConflictDoUpdate({
            target: [agentChannels.agent_id, agentChannels.channel_type],
            set: { config: channel.config, enabled: channel.enabled ?? true, updated_at: new Date() },
          })
      }

      const [[updatedAgent], updatedSkills, updatedChannels] = await Promise.all([
        tx.select().from(agents).where(eq(agents.id, agentId)).limit(1),
        tx.select().from(agentSkills).where(eq(agentSkills.agent_id, agentId)),
        tx.select().from(agentChannels).where(eq(agentChannels.agent_id, agentId)),
      ])

      return { ...updatedAgent, skills: updatedSkills, channels: updatedChannels }
    })

    return { data: result }
  })

  // DELETE /agents/:id — soft delete (status = 'archived')
  app.delete<{ Params: { id: string } }>('/agents/:id', async (request, reply) => {
    const db = getDb()
    const agentId = request.params.id

    const existing = await db.select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))
      .limit(1)

    if (!existing[0] || existing[0].status === 'archived') {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    await db.update(agents)
      .set({ status: 'archived', updated_at: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))

    return reply.status(204).send()
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
