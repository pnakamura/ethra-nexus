import { eq, and, sql, inArray } from 'drizzle-orm'
import { getDb, agents, agentSkills, agentChannels, budgets, providerUsageLog, auditLog, aiosEvents } from '@ethra-nexus/db'

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

    async insertAiosEvent(event: {
      tenant_id: string
      agent_id: string | null
      skill_id: string
      activation_mode: string
      payload: Record<string, unknown>
      triggered_by?: string | null
      user_ip?: string | null
      user_agent?: string | null
      call_depth?: number
    }): Promise<string> {
      const result = await db
        .insert(aiosEvents)
        .values({
          tenant_id: event.tenant_id,
          agent_id: event.agent_id ?? undefined,
          skill_id: event.skill_id,
          activation_mode: event.activation_mode,
          payload: event.payload,
          triggered_by: event.triggered_by ?? null,
          user_ip: event.user_ip ?? null,
          user_agent: event.user_agent ?? null,
          call_depth: event.call_depth ?? 0,
          status: 'running',
          triggered_at: new Date(),
          started_at: new Date(),
        })
        .returning({ id: aiosEvents.id })
      return result[0]!.id
    },

    async updateAiosEvent(
      eventId: string,
      update: {
        status: 'ok' | 'error'
        result?: Record<string, unknown>
        error_code?: string
        retryable?: boolean
        tokens_used?: number
        cost_usd?: number
      },
    ) {
      await db
        .update(aiosEvents)
        .set({
          status: update.status,
          result: update.result ?? null,
          error_code: update.error_code ?? null,
          retryable: update.retryable ?? false,
          tokens_used: update.tokens_used ?? 0,
          cost_usd: update.cost_usd != null ? update.cost_usd.toFixed(6) : '0',
          completed_at: new Date(),
        })
        .where(eq(aiosEvents.id, eventId))
    },

    async getBudgetAlertsFired(agentId: string, month: string): Promise<number[]> {
      const rows = await db
        .select({ payload: auditLog.payload })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entity_type, 'budget'),
            eq(auditLog.entity_id, agentId),
            eq(auditLog.action, 'budget_alert'),
          ),
        )
      return rows
        .map((r) => {
          const p = r.payload as Record<string, unknown>
          return p['month'] === month ? Number(p['threshold']) : null
        })
        .filter((t): t is number => t !== null)
    },

    async loadAgentWithDetails(agentId: string, tenantId: string) {
      const [[agent], skills, channels] = await Promise.all([
        db.select().from(agents)
          .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
          .limit(1),
        db.select().from(agentSkills).where(eq(agentSkills.agent_id, agentId)),
        db.select().from(agentChannels).where(eq(agentChannels.agent_id, agentId)),
      ])
      if (!agent) return null
      return { ...agent, skills, channels }
    },

    async loadAgentsWithDetails(tenantId: string) {
      const agentList = await db.select().from(agents)
        .where(and(eq(agents.tenant_id, tenantId), sql`${agents.status} != 'archived'`))

      if (agentList.length === 0) return []

      const agentIds = agentList.map((a) => a.id)
      const [skillsList, channelsList] = await Promise.all([
        db.select().from(agentSkills).where(inArray(agentSkills.agent_id, agentIds)),
        db.select().from(agentChannels).where(inArray(agentChannels.agent_id, agentIds)),
      ])

      return agentList.map((agent) => ({
        ...agent,
        skills: skillsList.filter((s) => s.agent_id === agent.id),
        channels: channelsList.filter((c) => c.agent_id === agent.id),
      }))
    },
  }
}
