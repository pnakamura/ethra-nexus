import type { FastifyInstance } from 'fastify'
import { eq, and, desc, avg, count, sql } from 'drizzle-orm'
import { getDb, agents, agentSkills, agentChannels, agentFeedback, aiosEvents } from '@ethra-nexus/db'
import { executeTask, createAgentsDb, writeLesson } from '@ethra-nexus/agents'
import { validateSlug, validateUUID, SecurityValidationError } from '@ethra-nexus/core'
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
      a2a_enabled?: boolean
      wiki_enabled?: boolean
      wiki_top_k?: number
      wiki_min_score?: number
      wiki_write_mode?: 'auto' | 'supervised' | 'manual'
      skills?: SkillInput[]
      channels?: ChannelInput[]
    }
  }>('/agents/:id', async (request, reply) => {
    try {
      validateUUID(request.params.id, 'id')
    } catch {
      return reply.status(400).send({ error: 'Invalid agent id format' })
    }

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

    if (body.wiki_top_k !== undefined && (body.wiki_top_k < 1 || body.wiki_top_k > 20)) {
      return reply.status(400).send({ error: 'wiki_top_k must be between 1 and 20' })
    }
    if (body.wiki_min_score !== undefined && (body.wiki_min_score < 0 || body.wiki_min_score > 1)) {
      return reply.status(400).send({ error: 'wiki_min_score must be between 0 and 1' })
    }
    if (body.wiki_write_mode !== undefined && !['auto', 'supervised', 'manual'].includes(body.wiki_write_mode)) {
      return reply.status(400).send({ error: 'wiki_write_mode must be auto, supervised, or manual' })
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

    try {
      const result = await db.transaction(async (tx) => {
        if (body.a2a_enabled === true) {
          const a2aExisting = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(and(
              eq(agents.tenant_id, request.tenantId),
              eq(agents.a2a_enabled, true),
            ))
            .limit(1)
          if (a2aExisting[0] && a2aExisting[0].id !== request.params.id) {
            throw Object.assign(new Error('Another agent already has a2a_enabled. Disable it first.'), { statusCode: 409 })
          }
        }

        const agentUpdate: Partial<{
          name: string
          model: string
          system_prompt: string
          system_prompt_extra: string | null
          response_language: string
          tone: string
          restrictions: string[]
          description: string | null
          avatar_url: string | null
          tags: string[]
          budget_monthly: string
          status: string
          a2a_enabled: boolean
          wiki_enabled: boolean
          wiki_top_k: number
          wiki_min_score: string
          wiki_write_mode: 'auto' | 'supervised' | 'manual'
          updated_at: Date
        }> = { updated_at: new Date() }
        if (body.name !== undefined) agentUpdate.name = body.name
        if (body.model !== undefined) agentUpdate.model = body.model
        if (body.system_prompt !== undefined) agentUpdate.system_prompt = body.system_prompt
        if (body.system_prompt_extra !== undefined) agentUpdate.system_prompt_extra = body.system_prompt_extra
        if (body.response_language !== undefined) agentUpdate.response_language = body.response_language
        if (body.tone !== undefined) agentUpdate.tone = body.tone
        if (body.restrictions !== undefined) agentUpdate.restrictions = body.restrictions
        if (body.description !== undefined) agentUpdate.description = body.description
        if (body.avatar_url !== undefined) agentUpdate.avatar_url = body.avatar_url
        if (body.tags !== undefined) agentUpdate.tags = body.tags
        if (body.budget_monthly !== undefined) agentUpdate.budget_monthly = body.budget_monthly
        if (body.status !== undefined) agentUpdate.status = body.status
        if (body.a2a_enabled !== undefined) agentUpdate.a2a_enabled = body.a2a_enabled
        if (body.wiki_enabled !== undefined) agentUpdate.wiki_enabled = body.wiki_enabled
        if (body.wiki_top_k !== undefined) agentUpdate.wiki_top_k = body.wiki_top_k
        if (body.wiki_min_score !== undefined) agentUpdate.wiki_min_score = String(body.wiki_min_score)
        if (body.wiki_write_mode !== undefined) agentUpdate.wiki_write_mode = body.wiki_write_mode

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
          tx.select().from(agents)
            .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))
            .limit(1),
          tx.select().from(agentSkills).where(eq(agentSkills.agent_id, agentId)),
          tx.select().from(agentChannels).where(eq(agentChannels.agent_id, agentId)),
        ])

        return { ...updatedAgent, skills: updatedSkills, channels: updatedChannels }
      })

      return { data: result }
    } catch (err) {
      if (err instanceof Error && (err as Error & { statusCode?: number }).statusCode === 409) {
        return reply.status(409).send({ error: err.message })
      }
      throw err
    }
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

  // GET /agents/:id/budget — status de orçamento do mês atual
  app.get<{ Params: { id: string } }>('/agents/:id/budget', async (request, reply) => {
    try {
      validateUUID(request.params.id, 'id')
    } catch {
      return reply.status(400).send({ error: 'Invalid agent id format' })
    }

    const db = getDb()
    const agentId = request.params.id

    const agentRows = await db
      .select({ id: agents.id, budget_monthly: agents.budget_monthly, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))
      .limit(1)

    const agent = agentRows[0]
    if (!agent || agent.status === 'archived') {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    const month = new Date().toISOString().slice(0, 7)
    const [budget, alertsFired] = await Promise.all([
      agentsDb.getBudget(agentId, month),
      agentsDb.getBudgetAlertsFired(agentId, month),
    ])

    const limitUsd = Number(agent.budget_monthly)
    const spentUsd = budget ? Number(budget.spent_usd) : 0
    const tokensUsed = budget?.tokens_used ?? 0
    const percentUsed = limitUsd > 0 ? Math.min(100, (spentUsd / limitUsd) * 100) : 0

    return {
      data: {
        month,
        limit_usd: limitUsd,
        spent_usd: spentUsd,
        tokens_used: tokensUsed,
        percent_used: Math.round(percentUsed * 100) / 100,
        throttled_at: budget?.throttled_at ?? null,
        alerts_fired: alertsFired,
      },
    }
  })

  // PATCH /agents/:id/budget — atualiza limite mensal de orçamento
  app.patch<{
    Params: { id: string }
    Body: { monthly_limit_usd: number }
  }>('/agents/:id/budget', async (request, reply) => {
    try {
      validateUUID(request.params.id, 'id')
    } catch {
      return reply.status(400).send({ error: 'Invalid agent id format' })
    }

    const { monthly_limit_usd } = request.body
    if (monthly_limit_usd === undefined || monthly_limit_usd === null) {
      return reply.status(400).send({ error: 'monthly_limit_usd is required' })
    }
    if (typeof monthly_limit_usd !== 'number' || !isFinite(monthly_limit_usd) || monthly_limit_usd < 0) {
      return reply.status(400).send({ error: 'monthly_limit_usd must be a non-negative number' })
    }

    const db = getDb()
    const agentId = request.params.id

    const existing = await db
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))
      .limit(1)

    if (!existing[0] || existing[0].status === 'archived') {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    await db.update(agents)
      .set({ budget_monthly: monthly_limit_usd.toFixed(2), updated_at: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))

    const month = new Date().toISOString().slice(0, 7)
    const [budget, alertsFired] = await Promise.all([
      agentsDb.getBudget(agentId, month),
      agentsDb.getBudgetAlertsFired(agentId, month),
    ])

    const spentUsd = budget ? Number(budget.spent_usd) : 0
    const tokensUsed = budget?.tokens_used ?? 0
    const percentUsed = monthly_limit_usd > 0 ? Math.min(100, (spentUsd / monthly_limit_usd) * 100) : 0

    return {
      data: {
        month,
        limit_usd: monthly_limit_usd,
        spent_usd: spentUsd,
        tokens_used: tokensUsed,
        percent_used: Math.round(percentUsed * 100) / 100,
        throttled_at: budget?.throttled_at ?? null,
        alerts_fired: alertsFired,
      },
    }
  })

  // GET /agents/:id/feedback — histórico de avaliações com métricas agregadas
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string }
  }>('/agents/:id/feedback', async (request, reply) => {
    try {
      validateUUID(request.params.id, 'id')
    } catch {
      return reply.status(400).send({ error: 'Invalid agent id format' })
    }

    const db = getDb()
    const agentId = request.params.id

    const agentRows = await db
      .select({ id: agents.id, status: agents.status })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))
      .limit(1)

    if (!agentRows[0] || agentRows[0].status === 'archived') {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    const limitParam = parseInt(request.query.limit ?? '20', 10)
    const limit = isNaN(limitParam) || limitParam < 1 ? 20 : Math.min(limitParam, 100)

    const [items, agg] = await Promise.all([
      db
        .select({
          id: agentFeedback.id,
          aios_event_id: agentFeedback.aios_event_id,
          rating: agentFeedback.rating,
          comment: agentFeedback.comment,
          created_by: agentFeedback.created_by,
          created_at: agentFeedback.created_at,
          event_skill_id: aiosEvents.skill_id,
          event_status: aiosEvents.status,
          event_triggered_at: aiosEvents.triggered_at,
        })
        .from(agentFeedback)
        .innerJoin(aiosEvents, eq(agentFeedback.aios_event_id, aiosEvents.id))
        .where(and(eq(agentFeedback.agent_id, agentId), eq(agentFeedback.tenant_id, request.tenantId)))
        .orderBy(desc(agentFeedback.created_at))
        .limit(limit),
      db
        .select({
          avg_rating: avg(agentFeedback.rating),
          total: count(agentFeedback.id),
          r1: count(sql`CASE WHEN ${agentFeedback.rating} = 1 THEN 1 END`),
          r2: count(sql`CASE WHEN ${agentFeedback.rating} = 2 THEN 1 END`),
          r3: count(sql`CASE WHEN ${agentFeedback.rating} = 3 THEN 1 END`),
          r4: count(sql`CASE WHEN ${agentFeedback.rating} = 4 THEN 1 END`),
          r5: count(sql`CASE WHEN ${agentFeedback.rating} = 5 THEN 1 END`),
        })
        .from(agentFeedback)
        .where(and(eq(agentFeedback.agent_id, agentId), eq(agentFeedback.tenant_id, request.tenantId))),
    ])

    const meta = agg[0]
    return {
      data: items.map((f) => ({
        id: f.id,
        aios_event_id: f.aios_event_id,
        rating: f.rating,
        comment: f.comment,
        created_by: f.created_by,
        created_at: f.created_at,
        event: {
          skill_id: f.event_skill_id,
          status: f.event_status,
          triggered_at: f.event_triggered_at,
        },
      })),
      meta: {
        total: Number(meta?.total ?? 0),
        avg_rating: meta?.avg_rating != null ? Math.round(Number(meta.avg_rating) * 100) / 100 : null,
        count_by_rating: {
          1: Number(meta?.r1 ?? 0),
          2: Number(meta?.r2 ?? 0),
          3: Number(meta?.r3 ?? 0),
          4: Number(meta?.r4 ?? 0),
          5: Number(meta?.r5 ?? 0),
        },
      },
    }
  })

  // POST /agents/:id/feedback — registra avaliação de uma execução
  // rating >= 4 dispara write-back na wiki (fire-and-forget)
  app.post<{
    Params: { id: string }
    Body: { aios_event_id: string; rating: number; comment?: string }
  }>('/agents/:id/feedback', async (request, reply) => {
    try {
      validateUUID(request.params.id, 'id')
    } catch {
      return reply.status(400).send({ error: 'Invalid agent id format' })
    }

    const { aios_event_id, rating, comment } = request.body

    if (!aios_event_id) {
      return reply.status(400).send({ error: 'aios_event_id is required' })
    }
    try {
      validateUUID(aios_event_id, 'aios_event_id')
    } catch {
      return reply.status(400).send({ error: 'Invalid aios_event_id format' })
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return reply.status(400).send({ error: 'rating must be an integer between 1 and 5' })
    }
    if (comment !== undefined && comment.length > 500) {
      return reply.status(400).send({ error: 'comment must be 500 characters or less' })
    }

    const db = getDb()
    const agentId = request.params.id

    const [agentRow, eventRow] = await Promise.all([
      db
        .select({ id: agents.id, status: agents.status, wiki_write_mode: agents.wiki_write_mode })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.tenant_id, request.tenantId)))
        .limit(1),
      db
        .select({ id: aiosEvents.id, payload: aiosEvents.payload, result: aiosEvents.result })
        .from(aiosEvents)
        .where(and(
          eq(aiosEvents.id, aios_event_id),
          eq(aiosEvents.agent_id, agentId),
          eq(aiosEvents.tenant_id, request.tenantId),
        ))
        .limit(1),
    ])

    if (!agentRow[0] || agentRow[0].status === 'archived') {
      return reply.status(404).send({ error: 'Agent not found' })
    }
    if (!eventRow[0]) {
      return reply.status(404).send({ error: 'Event not found for this agent' })
    }

    const createdBy = request.headers['x-user-id'] as string | undefined

    const [saved] = await db
      .insert(agentFeedback)
      .values({
        tenant_id: request.tenantId,
        agent_id: agentId,
        aios_event_id,
        rating,
        comment: comment ?? null,
        created_by: createdBy ?? null,
      })
      .onConflictDoUpdate({
        target: [agentFeedback.aios_event_id],
        set: { rating, comment: comment ?? null, created_by: createdBy ?? null },
      })
      .returning()

    // Wiki write-back: rating >= 4 reforça lição aprendida
    if (rating >= 4) {
      const event = eventRow[0]
      const payload = event.payload as Record<string, unknown>
      const result = event.result as Record<string, unknown> | null
      const question = typeof payload['question'] === 'string' ? payload['question'] : ''
      const answer = typeof result?.['answer'] === 'string' ? result['answer'] : ''

      if (question && answer) {
        const writeMode = (agentRow[0].wiki_write_mode ?? 'supervised') as 'manual' | 'supervised' | 'auto'
        void writeLesson({
          agent_id: agentId,
          tenant_id: request.tenantId,
          aios_event_id,
          question,
          answer,
          write_mode: writeMode,
        }).catch(() => undefined)
      }
    }

    return reply.status(201).send({ data: saved })
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
