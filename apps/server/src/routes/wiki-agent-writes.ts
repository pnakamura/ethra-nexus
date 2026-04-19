import type { FastifyInstance } from 'fastify'
import { eq, and, sql } from 'drizzle-orm'
import { getDb, wikiAgentWrites } from '@ethra-nexus/db'
import { embed } from '@ethra-nexus/wiki'
import { createWikiDb } from '@ethra-nexus/agents'

interface CreateWriteBody {
  agent_id: string
  slug: string
  title: string
  content: string
  type?: string
  target_wiki?: 'agent' | 'strategic'
  origin_ticket_id?: string
}

interface RejectBody {
  reason?: string
}

export async function wikiAgentWritesRoutes(app: FastifyInstance) {
  // GET /wiki/agent-writes/pending — lista propostas de agentes pendentes
  app.get('/wiki/agent-writes/pending', async (request) => {
    const db = getDb()
    const result = await db
      .select()
      .from(wikiAgentWrites)
      .where(
        and(
          eq(wikiAgentWrites.tenant_id, request.tenantId),
          eq(wikiAgentWrites.status, 'draft'),
        ),
      )
    return { data: result }
  })

  // POST /wiki/agent-writes — agente propõe novo conhecimento
  app.post<{ Body: CreateWriteBody }>('/wiki/agent-writes', async (request, reply) => {
    const { agent_id, slug, title, content, type = 'padrao', target_wiki = 'agent', origin_ticket_id } = request.body
    if (!agent_id || !slug || !title || !content) {
      return reply.status(400).send({ error: 'agent_id, slug, title and content are required' })
    }

    const db = getDb()
    const result = await db
      .insert(wikiAgentWrites)
      .values({
        tenant_id: request.tenantId,
        agent_id,
        slug,
        title,
        content,
        type,
        target_wiki,
        origin_ticket_id: origin_ticket_id ?? null,
        status: 'draft',
      })
      .returning()

    return reply.status(201).send({ data: result[0] })
  })

  // POST /wiki/agent-writes/:id/approve — aprova e promove para wiki
  app.post<{ Params: { id: string } }>('/wiki/agent-writes/:id/approve', async (request, reply) => {
    const db = getDb()
    const updateResult = await db
      .update(wikiAgentWrites)
      .set({ status: 'approved', reviewed_by: 'admin', reviewed_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(wikiAgentWrites.id, request.params.id),
          eq(wikiAgentWrites.tenant_id, request.tenantId),
        ),
      )
      .returning()

    const write = updateResult[0]
    if (!write) return reply.status(404).send({ error: 'Write not found' })

    let promoted = false
    if (write.target_wiki === 'strategic') {
      try {
        const wikiDb = createWikiDb()
        const page = await wikiDb.upsertStrategicPage({
          tenant_id: request.tenantId,
          slug: write.slug,
          title: write.title,
          type: write.type,
          content: write.content,
          sources: [],
          tags: [],
          confidence: 'media',
          author_type: 'agent',
        })

        try {
          const vector = await embed(`${page.title}\n\n${page.content}`)
          const vectorStr = `[${vector.join(',')}]`
          await db.execute(
            sql`UPDATE wiki_strategic_pages SET embedding = ${vectorStr}::vector WHERE id = ${page.id}`,
          )
        } catch (embedErr) {
          request.log.warn({ err: (embedErr as Error).message }, 'embedding failed after wiki write approval')
        }

        promoted = true
      } catch (err) {
        request.log.warn({ err: (err as Error).message }, 'failed to promote wiki write to strategic')
      }
    }

    return { data: write, promoted }
  })

  // POST /wiki/agent-writes/:id/reject — rejeita proposta
  app.post<{ Params: { id: string }; Body: RejectBody }>('/wiki/agent-writes/:id/reject', async (request, reply) => {
    const db = getDb()
    const result = await db
      .update(wikiAgentWrites)
      .set({
        status: 'rejected',
        reviewed_by: 'admin',
        reviewed_at: new Date(),
        updated_at: new Date(),
        metadata: { rejection_reason: request.body?.reason ?? '' },
      })
      .where(
        and(
          eq(wikiAgentWrites.id, request.params.id),
          eq(wikiAgentWrites.tenant_id, request.tenantId),
        ),
      )
      .returning()

    if (!result[0]) return reply.status(404).send({ error: 'Write not found' })
    return { data: result[0] }
  })
}
