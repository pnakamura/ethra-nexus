import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents, agentChannels } from '@ethra-nexus/db'
import { isValidChannelType, validateChannelConfig } from './agents.types'

export async function agentChannelsRoutes(app: FastifyInstance) {
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

  // POST /agents/:id/channels — cria canal (409 se já existe)
  app.post<{
    Params: { id: string }
    Body: {
      channel_type: string
      enabled?: boolean
      config?: Record<string, unknown>
    }
  }>('/agents/:id/channels', async (request, reply) => {
    const db = getDb()
    const agentId = request.params.id
    const { channel_type, enabled, config } = request.body

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    if (!isValidChannelType(channel_type)) {
      return reply.status(400).send({ error: `Invalid channel_type: "${channel_type}"` })
    }
    const configError = validateChannelConfig(channel_type, config ?? {})
    if (configError) return reply.status(400).send({ error: configError })

    try {
      const [channel] = await db
        .insert(agentChannels)
        .values({
          agent_id: agentId,
          tenant_id: request.tenantId,
          channel_type,
          enabled: enabled ?? true,
          config: config ?? {},
        })
        .returning()
      return reply.status(201).send({ data: channel })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('unique') || message.includes('duplicate')) {
        return reply.status(409).send({
          error: `Channel type "${channel_type}" already exists for this agent. Use PATCH to update.`,
        })
      }
      throw err
    }
  })

  // PATCH /agents/:id/channels/:channel_type — atualiza config com merge
  app.patch<{
    Params: { id: string; channel_type: string }
    Body: {
      enabled?: boolean
      config?: Record<string, unknown>
    }
  }>('/agents/:id/channels/:channel_type', async (request, reply) => {
    const db = getDb()
    const { id: agentId, channel_type } = request.params
    const body = request.body

    if (!isValidChannelType(channel_type)) {
      return reply.status(400).send({ error: `Invalid channel_type: "${channel_type}"` })
    }

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const current = await db
      .select()
      .from(agentChannels)
      .where(
        and(
          eq(agentChannels.agent_id, agentId),
          eq(agentChannels.channel_type, channel_type),
          eq(agentChannels.tenant_id, request.tenantId),
        ),
      )
      .limit(1)

    if (!current[0]) return reply.status(404).send({ error: 'Channel not found' })

    // Merge config: current + patch. Validate merged result to prevent removing required fields.
    const mergedConfig = {
      ...(current[0].config as Record<string, unknown>),
      ...(body.config ?? {}),
    }

    if (body.config !== undefined) {
      const configError = validateChannelConfig(channel_type, mergedConfig)
      if (configError) return reply.status(400).send({ error: configError })
    }

    const updateSet: { config?: Record<string, unknown>; enabled?: boolean; updated_at: Date } = {
      updated_at: new Date(),
    }
    if (body.config !== undefined) updateSet.config = mergedConfig
    if (body.enabled !== undefined) updateSet.enabled = body.enabled

    const [updated] = await db
      .update(agentChannels)
      .set(updateSet)
      .where(
        and(
          eq(agentChannels.agent_id, agentId),
          eq(agentChannels.channel_type, channel_type),
          eq(agentChannels.tenant_id, request.tenantId),
        ),
      )
      .returning()

    return { data: updated }
  })

  // DELETE /agents/:id/channels/:channel_type — remove canal
  app.delete<{
    Params: { id: string; channel_type: string }
  }>('/agents/:id/channels/:channel_type', async (request, reply) => {
    const db = getDb()
    const { id: agentId, channel_type } = request.params

    if (!isValidChannelType(channel_type)) {
      return reply.status(400).send({ error: `Invalid channel_type: "${channel_type}"` })
    }

    const agent = await requireAgent(agentId, request.tenantId)
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const deleted = await db
      .delete(agentChannels)
      .where(
        and(
          eq(agentChannels.agent_id, agentId),
          eq(agentChannels.channel_type, channel_type),
          eq(agentChannels.tenant_id, request.tenantId),
        ),
      )
      .returning()

    if (deleted.length === 0) return reply.status(404).send({ error: 'Channel not found' })

    return reply.status(204).send()
  })
}
