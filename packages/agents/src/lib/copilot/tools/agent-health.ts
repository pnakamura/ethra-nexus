import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

type Period = 'last_24h' | 'last_7d' | 'last_30d'

interface AgentHealthInput {
  agent_id: string
  period?: Period
}

interface AgentHealth {
  total_events: number
  success_rate: number
  error_rate: number
  p50_latency_ms: number
  p95_latency_ms: number
  top_skills: Array<{ skill_id: string; count: number }>
  top_errors: Array<{ error_code: string; count: number }>
}

const PERIOD_FILTER: Record<Period, string> = {
  last_24h: "started_at >= now() - interval '24 hours'",
  last_7d:  "started_at >= now() - interval '7 days'",
  last_30d: "started_at >= now() - interval '30 days'",
}

export const agentHealthTool: CopilotTool<AgentHealthInput, AgentHealth> = {
  name: 'system:agent_health',
  description: 'Saúde operacional de um agente: total de execuções, taxa de sucesso/erro, latência p50/p95, top skills usadas, top códigos de erro. Use para "esse agente está bem", "por que está caro", "tem muito erro".',
  input_schema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', format: 'uuid' },
      period:   { type: 'string', enum: ['last_24h', 'last_7d', 'last_30d'] },
    },
    required: ['agent_id'],
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    const period = input.period ?? 'last_7d'
    const filter = PERIOD_FILTER[period]
    const db = getDb()
    const agentId = input.agent_id.replace(/'/g, "''")
    const tenantId = ctx.tenant_id.replace(/'/g, "''")

    const aggResult = await db.execute(sql.raw(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE status = 'error')::text AS errors,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::text AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::text AS p95
      FROM aios_events
      WHERE agent_id = '${agentId}'
        AND tenant_id = '${tenantId}'
        AND ${filter}
        AND completed_at IS NOT NULL
    `))

    type AggRow = { total: string; errors: string; p50: string | null; p95: string | null }
    const agg = (aggResult.rows[0] as AggRow) ?? { total: '0', errors: '0', p50: null, p95: null }
    const total = Number(agg.total)
    const errors = Number(agg.errors)

    const skillsResult = await db.execute(sql.raw(`
      SELECT skill_id, COUNT(*)::text AS count FROM aios_events
      WHERE agent_id = '${agentId}' AND tenant_id = '${tenantId}' AND ${filter}
      GROUP BY skill_id ORDER BY count DESC LIMIT 5
    `))

    const errorsResult = await db.execute(sql.raw(`
      SELECT error_code, COUNT(*)::text AS count FROM aios_events
      WHERE agent_id = '${agentId}' AND tenant_id = '${tenantId}' AND ${filter}
        AND error_code IS NOT NULL
      GROUP BY error_code ORDER BY count DESC LIMIT 5
    `))

    return {
      total_events: total,
      success_rate: total > 0 ? (total - errors) / total : 0,
      error_rate:   total > 0 ? errors / total : 0,
      p50_latency_ms: agg.p50 ? Math.round(Number(agg.p50)) : 0,
      p95_latency_ms: agg.p95 ? Math.round(Number(agg.p95)) : 0,
      top_skills: (skillsResult.rows as Array<{ skill_id: string; count: string }>).map(r => ({ skill_id: r.skill_id, count: Number(r.count) })),
      top_errors: (errorsResult.rows as Array<{ error_code: string; count: string }>).map(r => ({ error_code: r.error_code, count: Number(r.count) })),
    }
  },
}
