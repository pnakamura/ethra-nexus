import { eq, and, desc } from 'drizzle-orm'
import { getDb, wikiAgentWrites, agents } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface ListPendingApprovalsInput {
  agent_id?: string
}

interface PendingApproval {
  id: string
  agent_name: string | null
  slug: string
  title: string
  target_wiki: string
  created_at: string
  content_preview: string
}

export const listPendingApprovalsTool: CopilotTool<ListPendingApprovalsInput, PendingApproval[]> = {
  name: 'system:list_pending_approvals',
  description: 'Lista propostas de escrita na wiki pendentes de aprovação humana (HITL). Cada item: agente proponente, slug, título, target wiki, preview do conteúdo. Use para "tem coisa pra aprovar", "fila HITL", "aprovações pendentes".',
  input_schema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', format: 'uuid', description: 'Filtra por agente proponente. Omitir para todas.' },
    },
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    const db = getDb()
    const conditions = [
      eq(wikiAgentWrites.tenant_id, ctx.tenant_id),
      eq(wikiAgentWrites.status, 'draft'),
    ]
    if (input.agent_id) conditions.push(eq(wikiAgentWrites.agent_id, input.agent_id))

    const rows = await db.select({
      id: wikiAgentWrites.id,
      agent_name: agents.name,
      slug: wikiAgentWrites.slug,
      title: wikiAgentWrites.title,
      content: wikiAgentWrites.content,
      target_wiki: wikiAgentWrites.target_wiki,
      created_at: wikiAgentWrites.created_at,
    })
      .from(wikiAgentWrites)
      .leftJoin(agents, eq(agents.id, wikiAgentWrites.agent_id))
      .where(and(...conditions))
      .orderBy(desc(wikiAgentWrites.created_at))
      .limit(50)

    return rows.map(r => {
      const createdAt = r.created_at instanceof Date ? r.created_at : new Date(r.created_at)
      return {
        id: r.id,
        agent_name: r.agent_name,
        slug: r.slug,
        title: r.title,
        target_wiki: r.target_wiki,
        created_at: createdAt.toISOString(),
        content_preview: r.content.slice(0, 200),
      }
    })
  },
}
