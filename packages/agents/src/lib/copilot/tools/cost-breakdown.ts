import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

type GroupBy = 'agent' | 'skill' | 'day'
type Period = 'last_7d' | 'last_30d' | 'this_month'

interface CostBreakdownInput {
  group_by: GroupBy
  period?: Period
  limit?: number
}

interface CostRow {
  group_value: string
  total_cost_usd: number
  total_tokens: number
  event_count: number
}

const GROUP_EXPR: Record<GroupBy, string> = {
  agent: 'a.name',
  skill: 'e.skill_id',
  day:   "to_char(e.started_at, 'YYYY-MM-DD')",
}

const PERIOD_FILTER: Record<Period, string> = {
  last_7d:    "e.started_at >= now() - interval '7 days'",
  last_30d:   "e.started_at >= now() - interval '30 days'",
  this_month: "to_char(e.started_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM')",
}

export const costBreakdownTool: CopilotTool<CostBreakdownInput, CostRow[]> = {
  name: 'system:cost_breakdown',
  description: 'Análise agregada de custo por agente, skill ou dia, em um período (últimos 7d / 30d / mês). Use para "qual skill é mais cara", "quem gastou mais", "tendência diária".',
  input_schema: {
    type: 'object',
    properties: {
      group_by: { type: 'string', enum: ['agent', 'skill', 'day'] },
      period:   { type: 'string', enum: ['last_7d', 'last_30d', 'this_month'] },
      limit:    { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['group_by'],
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    if (!(input.group_by in GROUP_EXPR)) throw new Error(`Invalid group_by: ${input.group_by}`)
    const period = input.period ?? 'this_month'
    const limit = Math.min(input.limit ?? 20, 50)
    const db = getDb()
    const groupExpr = GROUP_EXPR[input.group_by]
    const periodFilter = PERIOD_FILTER[period]

    // Raw SQL for flexible group_by — tenant_id escaped, period+group_by from closed enum.
    const result = await db.execute(sql.raw(`
      SELECT
        ${groupExpr} AS group_value,
        SUM(e.cost_usd)::text AS total_cost_usd,
        SUM(e.tokens_used)::text AS total_tokens,
        COUNT(*)::text AS event_count
      FROM aios_events e
      LEFT JOIN agents a ON a.id = e.agent_id
      WHERE e.tenant_id = '${ctx.tenant_id.replace(/'/g, "''")}'
        AND ${periodFilter}
      GROUP BY group_value
      ORDER BY SUM(e.cost_usd) DESC
      LIMIT ${limit}
    `))

    type Row = { group_value: string | null; total_cost_usd: string; total_tokens: string; event_count: string }
    return (result.rows as Row[])
      .filter(r => r.group_value !== null)
      .map(r => ({
        group_value: r.group_value as string,
        total_cost_usd: Number(r.total_cost_usd),
        total_tokens: Number(r.total_tokens),
        event_count: Number(r.event_count),
      }))
  },
}
