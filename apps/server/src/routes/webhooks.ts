import type { FastifyInstance } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { getDb, agents, agentEventSubscriptions } from '@ethra-nexus/db'
import { timingSafeEqual } from 'crypto'
import { executeTask, dispatchOutput } from '@ethra-nexus/agents'
import type { SkillId } from '@ethra-nexus/core'

export async function webhookRoutes(app: FastifyInstance) {
  // POST /webhooks/:agentSlug/:eventType — public (no JWT), X-Webhook-Secret required
  app.post<{
    Params: { agentSlug: string; eventType: string }
    Body: Record<string, unknown>
  }>('/webhooks/:agentSlug/:eventType', async (request, reply) => {
    const db = getDb()
    const { agentSlug, eventType } = request.params
    const providedSecret = (request.headers['x-webhook-secret'] as string | undefined) ?? ''

    const agentRows = await db.select()
      .from(agents)
      .where(eq(agents.slug, agentSlug))
      .limit(1)

    const agent = agentRows[0]
    if (!agent) return reply.status(404).send({ error: 'Agent not found' })

    const subscriptions = await db.select()
      .from(agentEventSubscriptions)
      .where(and(
        eq(agentEventSubscriptions.agent_id, agent.id),
        eq(agentEventSubscriptions.event_type, 'webhook'),
        eq(agentEventSubscriptions.enabled, true),
      ))

    const matched = subscriptions.filter((sub) => {
      const filter = sub.event_filter as Record<string, unknown>
      if (filter['event_type'] !== undefined && filter['event_type'] !== eventType) return false
      const storedSecret = (filter['webhook_secret'] as string | undefined) ?? ''
      if (!storedSecret) return false
      const a = Buffer.from(storedSecret)
      const b = Buffer.from(providedSecret)
      if (a.length !== b.length) return false
      return timingSafeEqual(a, b)
    })

    if (matched.length === 0) return reply.status(401).send({ error: 'Invalid webhook secret' })

    // Fire-and-forget: respond 202 immediately, execute in background
    void Promise.allSettled(
      matched.map(async (sub) => {
        const result = await executeTask({
          tenant_id: sub.tenant_id,
          agent_id: sub.agent_id,
          skill_id: sub.skill_id as SkillId,
          input: { ...(sub.input as Record<string, unknown>), ...request.body },
          activation_mode: 'event',
          activation_source: `webhook:${eventType}`,
          triggered_by: 'webhook',
        })
        await dispatchOutput(result, {
          tenant_id: sub.tenant_id,
          agent_id: sub.agent_id,
          skill_id: sub.skill_id,
          output_channel: sub.output_channel,
        })
      }),
    )

    return reply.status(202).send({ ok: true, triggered: matched.length })
  })
}
