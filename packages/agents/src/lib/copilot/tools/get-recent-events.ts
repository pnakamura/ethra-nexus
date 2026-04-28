import { eq, and, desc, gte } from 'drizzle-orm'
import { getDb, aiosEvents, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface GetRecentEventsInput {
  limit?: number
  agent_id?: string
  status?: 'ok' | 'error' | 'running'
  skill_id?: string
  since?: string  // ISO8601
}

interface EventSummary {
  id: string
  agent_id: string | null
  agent_name: string | null
  skill_id: string
  status: string
  started_at: string
  completed_at: string | null
  tokens_used: number
  cost_usd: number
  error_code: string | null
  latency_ms: number | null
}

export const getRecentEventsTool: CopilotTool<GetRecentEventsInput, EventSummary[]> = {
  name: 'system:get_recent_events',
  description: 'Lista os eventos de execução mais recentes (aios_events) do tenant. Cada evento traz agente, skill, status, tempos e custo. Use para "últimas execuções", "atividade recente", "execuções de hoje", filtros por agente/status/skill.',
  input_schema: {
    type: 'object',
    properties: {
      limit:    { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20, máximo 100' },
      agent_id: { type: 'string', description: 'UUID do agente para filtrar' },
      status:   { type: 'string', enum: ['ok', 'error', 'running'] },
      skill_id: { type: 'string', description: 'Ex: wiki:query' },
      since:    { type: 'string', format: 'date-time', description: 'ISO8601, limita para eventos depois desta data' },
    },
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    const db = getDb()
    const limit = Math.min(input.limit ?? 20, 100)
    const conditions = [eq(aiosEvents.tenant_id, ctx.tenant_id)]
    if (input.agent_id) conditions.push(eq(aiosEvents.agent_id, input.agent_id))
    if (input.status)   conditions.push(eq(aiosEvents.status, input.status))
    if (input.skill_id) conditions.push(eq(aiosEvents.skill_id, input.skill_id))
    if (input.since)    conditions.push(gte(aiosEvents.started_at, new Date(input.since)))

    const rows = await db.select({
      id: aiosEvents.id,
      agent_id: aiosEvents.agent_id,
      agent_name: agents.name,
      skill_id: aiosEvents.skill_id,
      status: aiosEvents.status,
      started_at: aiosEvents.started_at,
      completed_at: aiosEvents.completed_at,
      tokens_used: aiosEvents.tokens_used,
      cost_usd: aiosEvents.cost_usd,
      error_code: aiosEvents.error_code,
    })
      .from(aiosEvents)
      .leftJoin(agents, eq(agents.id, aiosEvents.agent_id))
      .where(and(...conditions))
      .orderBy(desc(aiosEvents.started_at))
      .limit(limit)

    return rows.map((r): EventSummary => {
      const startedAt = r.started_at instanceof Date ? r.started_at : new Date(r.started_at)
      const completedAt = r.completed_at ? (r.completed_at instanceof Date ? r.completed_at : new Date(r.completed_at)) : null
      return {
        id: r.id,
        agent_id: r.agent_id,
        agent_name: r.agent_name,
        skill_id: r.skill_id,
        status: r.status,
        started_at: startedAt.toISOString(),
        completed_at: completedAt?.toISOString() ?? null,
        tokens_used: r.tokens_used ?? 0,
        cost_usd: Number(r.cost_usd ?? 0),
        error_code: r.error_code,
        latency_ms: completedAt ? completedAt.getTime() - startedAt.getTime() : null,
      }
    })
  },
}
