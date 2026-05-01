import { eq, and } from 'drizzle-orm'
import { getDb, budgets, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface GetBudgetStatusInput {
  agent_id?: string
  month?: string  // 'YYYY-MM'
}

interface BudgetStatus {
  total_usd: number
  limit_usd: number
  percent_used: number
  by_agent: Array<{ agent_id: string; agent_name: string | null; spent_usd: number; limit_usd: number; percent: number }>
  days_until_reset: number
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function daysUntilReset(): number {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export const getBudgetStatusTool: CopilotTool<GetBudgetStatusInput, BudgetStatus> = {
  name: 'system:get_budget_status',
  description: 'Status de orçamento mensal do tenant (sem agent_id) ou de um agente específico. Retorna total gasto, limite, % usado, breakdown por agente, dias até reset. Use para "quanto gastei", "estou dentro do orçamento", "quem consome mais".',
  input_schema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', description: 'UUID do agente. Omitir para agregado do tenant.' },
      month:    { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM. Default: mês corrente.' },
    },
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    const db = getDb()
    const month = input.month ?? currentMonth()

    const conditions = [eq(budgets.tenant_id, ctx.tenant_id), eq(budgets.month, month)]
    if (input.agent_id) conditions.push(eq(budgets.agent_id, input.agent_id))

    const rows = await db.select({
      agent_id:   budgets.agent_id,
      agent_name: agents.name,
      spent_usd:  budgets.spent_usd,
      limit_usd:  agents.budget_monthly,
    })
      .from(budgets)
      .leftJoin(agents, eq(agents.id, budgets.agent_id))
      .where(and(...conditions))

    let totalSpent = 0
    let totalLimit = 0
    const byAgent = rows.map(r => {
      const spent = Number(r.spent_usd ?? 0)
      const limit = Number(r.limit_usd ?? 0)
      totalSpent += spent
      totalLimit += limit
      return {
        agent_id: r.agent_id,
        agent_name: r.agent_name,
        spent_usd: spent,
        limit_usd: limit,
        percent: limit > 0 ? (spent / limit) * 100 : 0,
      }
    })

    return {
      total_usd: totalSpent,
      limit_usd: totalLimit,
      percent_used: totalLimit > 0 ? (totalSpent / totalLimit) * 100 : 0,
      by_agent: byAgent,
      days_until_reset: daysUntilReset(),
    }
  },
}
