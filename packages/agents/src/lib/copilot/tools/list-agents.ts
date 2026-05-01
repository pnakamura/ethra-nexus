import { eq, and } from 'drizzle-orm'
import { getDb, agents, agentSkills, agentChannels } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface ListAgentsInput {
  status?: 'active' | 'paused' | 'archived'
}

interface AgentSummary {
  id: string
  slug: string
  name: string
  role: string
  status: string
  model: string
  budget_monthly: number
  skills_count: number
  channels_count: number
}

export const listAgentsTool: CopilotTool<ListAgentsInput, AgentSummary[]> = {
  name: 'system:list_agents',
  description: 'Lista agentes do tenant atual com slug, nome, role, status, modelo, orçamento mensal, e contagem de skills e channels. Use para responder "quais agentes existem", "quem está ativo", overview de configuração.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['active', 'paused', 'archived'], description: 'Filtra por status. Omitir para todos.' },
    },
  },
  permission: 'all_members',
  handler: async (input, ctx) => {
    const db = getDb()
    const conditions = [eq(agents.tenant_id, ctx.tenant_id)]
    if (input.status) conditions.push(eq(agents.status, input.status))

    const rows = await db.select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      role: agents.role,
      status: agents.status,
      model: agents.model,
      budget_monthly: agents.budget_monthly,
    }).from(agents).where(and(...conditions))

    const enriched: AgentSummary[] = []
    for (const a of rows) {
      const skills = await db.select({ id: agentSkills.id }).from(agentSkills).where(eq(agentSkills.agent_id, a.id))
      const channels = await db.select({ id: agentChannels.id }).from(agentChannels).where(eq(agentChannels.agent_id, a.id))
      enriched.push({
        id: a.id,
        slug: a.slug,
        name: a.name,
        role: a.role ?? '',
        status: a.status,
        model: a.model,
        budget_monthly: Number(a.budget_monthly),
        skills_count: skills.length,
        channels_count: channels.length,
      })
    }
    return enriched
  },
}
