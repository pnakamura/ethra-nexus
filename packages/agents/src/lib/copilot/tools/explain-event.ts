import { eq, and } from 'drizzle-orm'
import { getDb, aiosEvents, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface ExplainEventInput {
  event_id: string
}

interface EventDetails {
  id: string
  agent_id: string | null
  agent_name: string | null
  skill_id: string
  status: string
  payload: unknown
  result: unknown
  error_code: string | null
  started_at: string
  completed_at: string | null
  tokens_used: number
  cost_usd: number
  call_depth: number
  parent_event_id: string | null
  children: Array<{ id: string; skill_id: string; status: string }>
}

export const explainEventTool: CopilotTool<ExplainEventInput, EventDetails> = {
  name: 'system:explain_event',
  description: 'Drill-down completo em um evento de execução: payload, result, latência, custo, eventos filhos (chains multi-agente). Use para "por que esse evento falhou?", "o que aconteceu em #abc123?", debugging.',
  input_schema: {
    type: 'object',
    properties: {
      event_id: { type: 'string', format: 'uuid', description: 'UUID completo do evento' },
    },
    required: ['event_id'],
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    const db = getDb()

    const eventRows = await db.select({
      id: aiosEvents.id,
      agent_id: aiosEvents.agent_id,
      agent_name: agents.name,
      skill_id: aiosEvents.skill_id,
      status: aiosEvents.status,
      payload: aiosEvents.payload,
      result: aiosEvents.result,
      error_code: aiosEvents.error_code,
      started_at: aiosEvents.started_at,
      completed_at: aiosEvents.completed_at,
      tokens_used: aiosEvents.tokens_used,
      cost_usd: aiosEvents.cost_usd,
      call_depth: aiosEvents.call_depth,
      parent_event_id: aiosEvents.parent_event_id,
    })
      .from(aiosEvents)
      .leftJoin(agents, eq(agents.id, aiosEvents.agent_id))
      .where(and(eq(aiosEvents.id, input.event_id), eq(aiosEvents.tenant_id, ctx.tenant_id)))
      .limit(1)

    const event = eventRows[0]
    if (!event) throw new Error('Event not found')

    const children = await db.select({
      id: aiosEvents.id, skill_id: aiosEvents.skill_id, status: aiosEvents.status,
    })
      .from(aiosEvents)
      .where(and(eq(aiosEvents.parent_event_id, input.event_id), eq(aiosEvents.tenant_id, ctx.tenant_id)))
      .limit(20)

    const startedAt = event.started_at instanceof Date ? event.started_at : new Date(event.started_at)
    const completedAt = event.completed_at ? (event.completed_at instanceof Date ? event.completed_at : new Date(event.completed_at)) : null

    return {
      id: event.id,
      agent_id: event.agent_id,
      agent_name: event.agent_name,
      skill_id: event.skill_id,
      status: event.status,
      payload: event.payload,
      result: event.result,
      error_code: event.error_code,
      started_at: startedAt.toISOString(),
      completed_at: completedAt?.toISOString() ?? null,
      tokens_used: event.tokens_used ?? 0,
      cost_usd: Number(event.cost_usd ?? 0),
      call_depth: event.call_depth ?? 0,
      parent_event_id: event.parent_event_id,
      children: children.map(c => ({ id: c.id, skill_id: c.skill_id, status: c.status })),
    }
  },
}
