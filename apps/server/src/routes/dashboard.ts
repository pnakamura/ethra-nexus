import type { FastifyInstance } from 'fastify'
import { eq, and, gte, count, sum, sql } from 'drizzle-orm'
import { getDb, agents, aiosEvents, agentSkills } from '@ethra-nexus/db'

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', async (request) => {
    const db = getDb()
    const tenantId = request.tenantId

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [activeAgents, eventStats, recentAgents] = await Promise.all([
      db
        .select({ count: count() })
        .from(agents)
        .where(and(eq(agents.tenant_id, tenantId), eq(agents.status, 'active'))),

      db
        .select({
          executions: count(),
          cost_usd: sum(aiosEvents.cost_usd),
        })
        .from(aiosEvents)
        .where(
          and(
            eq(aiosEvents.tenant_id, tenantId),
            gte(aiosEvents.started_at, monthStart),
          ),
        ),

      db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          status: agents.status,
          created_at: agents.created_at,
        })
        .from(agents)
        .where(
          and(
            eq(agents.tenant_id, tenantId),
            sql`${agents.status} != 'archived'`,
          ),
        )
        .orderBy(sql`${agents.created_at} desc`)
        .limit(5),
    ])

    const agentIds = recentAgents.map((a) => a.id)
    const skillsByAgent: Record<string, string[]> = {}

    if (agentIds.length > 0) {
      const skills = await db
        .select({ agent_id: agentSkills.agent_id, skill_name: agentSkills.skill_name })
        .from(agentSkills)
        .where(sql`${agentSkills.agent_id} = ANY(ARRAY[${sql.join(agentIds.map((id) => sql`${id}::uuid`), sql`, `)}])`)

      for (const s of skills) {
        if (!skillsByAgent[s.agent_id]) skillsByAgent[s.agent_id] = []
        skillsByAgent[s.agent_id]!.push(s.skill_name)
      }
    }

    return {
      data: {
        agents_active: activeAgents[0]?.count ?? 0,
        executions_month: eventStats[0]?.executions ?? 0,
        cost_usd_month: parseFloat(String(eventStats[0]?.cost_usd ?? '0')),
        recent_agents: recentAgents.map((a) => ({
          ...a,
          skills: skillsByAgent[a.id] ?? [],
        })),
      },
    }
  })
}
