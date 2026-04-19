import { eq, and, sql } from 'drizzle-orm'
import { getDb, agents, budgets, providerUsageLog, auditLog } from '@ethra-nexus/db'

// ============================================================
// DB Agents — queries Drizzle para o orquestrador
//
// Substitui o antigo packages/agents/src/lib/supabase/db-agents.ts
// que usava @supabase/supabase-js.
// ============================================================

export function createAgentsDb() {
  const db = getDb()

  return {
    async getAgent(agentId: string) {
      const result = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1)
      return result[0] ?? null
    },

    async getAgentsByTenant(tenantId: string) {
      return db
        .select()
        .from(agents)
        .where(eq(agents.tenant_id, tenantId))
    },

    async updateAgentStatus(agentId: string, status: string) {
      await db
        .update(agents)
        .set({ status, updated_at: new Date() })
        .where(eq(agents.id, agentId))
    },

    async updateAgentLastActive(agentId: string) {
      await db
        .update(agents)
        .set({ updated_at: new Date() })
        .where(eq(agents.id, agentId))
    },

    async getBudget(agentId: string, month: string) {
      const result = await db
        .select()
        .from(budgets)
        .where(
          and(
            eq(budgets.agent_id, agentId),
            eq(budgets.month, month),
          ),
        )
        .limit(1)
      return result[0] ?? null
    },

    async upsertBudget(agentId: string, tenantId: string, month: string, spentUsd: number, tokensUsed: number) {
      await db
        .insert(budgets)
        .values({
          agent_id: agentId,
          tenant_id: tenantId,
          month,
          spent_usd: spentUsd.toFixed(4),
          tokens_used: tokensUsed,
        })
        .onConflictDoUpdate({
          target: [budgets.agent_id, budgets.month],
          set: {
            spent_usd: sql`${budgets.spent_usd} + ${spentUsd.toFixed(4)}::numeric`,
            tokens_used: sql`${budgets.tokens_used} + ${tokensUsed}`,
          },
        })
    },

    async logProviderUsage(entry: {
      tenant_id: string
      agent_id: string
      skill_id: string
      provider: string
      model: string
      tokens_in: number
      tokens_out: number
      cost_usd: number
      latency_ms: number
      is_fallback: boolean
      is_sensitive: boolean
    }) {
      await db.insert(providerUsageLog).values({
        tenant_id: entry.tenant_id,
        agent_id: entry.agent_id,
        skill_id: entry.skill_id,
        provider: entry.provider,
        model: entry.model,
        tokens_in: entry.tokens_in,
        tokens_out: entry.tokens_out,
        cost_usd: entry.cost_usd.toFixed(6),
        latency_ms: entry.latency_ms,
        is_fallback: entry.is_fallback,
        is_sensitive: entry.is_sensitive,
      })
    },

    async insertAuditEntry(entry: {
      tenant_id: string
      entity_type: string
      entity_id: string
      action: string
      actor: string
      payload?: Record<string, unknown>
      user_ip?: string
    }) {
      await db.insert(auditLog).values({
        tenant_id: entry.tenant_id,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        action: entry.action,
        actor: entry.actor,
        payload: entry.payload ?? {},
        user_ip: entry.user_ip,
      })
    },

    async canExecute(
      agentId: string,
      month: string,
      estimatedCostUsd: number,
    ): Promise<{ allowed: boolean; reason?: string }> {
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
      const a = agent[0]
      if (!a) return { allowed: false, reason: 'Agent not found' }
      if (a.status !== 'active') return { allowed: false, reason: `Agent is ${a.status}` }

      const limitUsd = Number(a.budget_monthly)
      if (limitUsd === 0) return { allowed: true }

      const budgetRows = await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.agent_id, agentId), eq(budgets.month, month)))
        .limit(1)
      const spentUsd = budgetRows[0] ? Number(budgetRows[0].spent_usd) : 0

      if (spentUsd + estimatedCostUsd > limitUsd) {
        return {
          allowed: false,
          reason: `Budget exceeded: ${spentUsd.toFixed(2)}/${limitUsd.toFixed(2)} USD`,
        }
      }
      return { allowed: true }
    },
  }
}
