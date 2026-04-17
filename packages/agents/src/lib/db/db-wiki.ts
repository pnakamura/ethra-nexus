import { eq, and, sql } from 'drizzle-orm'
import {
  getDb,
  wikiStrategicPages,
  wikiAgentPages,
  wikiOperationsLog,
  wikiAgentWrites,
} from '@ethra-nexus/db'

// ============================================================
// DB Wiki — queries Drizzle para o subsistema wiki
//
// Substitui packages/agents/src/lib/supabase/db-wiki.ts
// ============================================================

export function createWikiDb() {
  const db = getDb()

  return {
    // ── Strategic Pages ───────────────────────────────────
    async getStrategicPages(tenantId: string) {
      return db
        .select()
        .from(wikiStrategicPages)
        .where(
          and(
            eq(wikiStrategicPages.tenant_id, tenantId),
            eq(wikiStrategicPages.status, 'ativo'),
          ),
        )
    },

    async upsertStrategicPage(page: {
      tenant_id: string
      slug: string
      title: string
      type: string
      content: string
      sources?: unknown[]
      tags?: unknown[]
      confidence: string
      author_type: string
    }) {
      const result = await db
        .insert(wikiStrategicPages)
        .values({
          tenant_id: page.tenant_id,
          slug: page.slug,
          title: page.title,
          type: page.type,
          content: page.content,
          sources: page.sources ?? [],
          tags: page.tags ?? [],
          confidence: page.confidence,
          author_type: page.author_type,
        })
        .onConflictDoUpdate({
          target: [wikiStrategicPages.tenant_id, wikiStrategicPages.slug],
          set: {
            title: page.title,
            type: page.type,
            content: page.content,
            sources: page.sources ?? [],
            tags: page.tags ?? [],
            confidence: page.confidence,
            updated_at: new Date(),
          },
        })
        .returning()

      return result[0]!
    },

    // ── Agent Pages ───────────────────────────────────────
    async getAgentPages(agentId: string) {
      return db
        .select()
        .from(wikiAgentPages)
        .where(
          and(
            eq(wikiAgentPages.agent_id, agentId),
            eq(wikiAgentPages.status, 'ativo'),
          ),
        )
    },

    async upsertAgentPage(page: {
      agent_id: string
      tenant_id: string
      slug: string
      title: string
      type: string
      content: string
      origin?: string
      confidence: string
    }) {
      const result = await db
        .insert(wikiAgentPages)
        .values({
          agent_id: page.agent_id,
          tenant_id: page.tenant_id,
          slug: page.slug,
          title: page.title,
          type: page.type,
          content: page.content,
          origin: page.origin,
          confidence: page.confidence,
        })
        .onConflictDoUpdate({
          target: [wikiAgentPages.agent_id, wikiAgentPages.slug],
          set: {
            title: page.title,
            type: page.type,
            content: page.content,
            origin: page.origin,
            confidence: page.confidence,
            updated_at: new Date(),
          },
        })
        .returning()

      return result[0]!
    },

    // ── Operations Log ────────────────────────────────────
    async logOperation(entry: {
      tenant_id: string
      agent_id?: string
      operation: string
      scope: string
      target_page_id?: string
      summary: string
    }) {
      await db.insert(wikiOperationsLog).values({
        tenant_id: entry.tenant_id,
        agent_id: entry.agent_id,
        operation: entry.operation,
        scope: entry.scope,
        target_page_id: entry.target_page_id,
        summary: entry.summary,
      })
    },

    // ── Agent Writes (staging) ────────────────────────────
    async createAgentWrite(draft: {
      tenant_id: string
      agent_id: string
      target_wiki: string
      slug: string
      title: string
      content: string
      type: string
      origin_ticket_id?: string
    }) {
      const result = await db
        .insert(wikiAgentWrites)
        .values({
          tenant_id: draft.tenant_id,
          agent_id: draft.agent_id,
          target_wiki: draft.target_wiki,
          slug: draft.slug,
          title: draft.title,
          content: draft.content,
          type: draft.type,
          origin_ticket_id: draft.origin_ticket_id,
        })
        .returning()

      return result[0]!
    },

    async approveAgentWrite(writeId: string, tenantId: string, reviewedBy: string) {
      const result = await db
        .update(wikiAgentWrites)
        .set({
          status: 'approved',
          reviewed_by: reviewedBy,
          reviewed_at: new Date(),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(wikiAgentWrites.id, writeId),
            eq(wikiAgentWrites.tenant_id, tenantId),
          ),
        )
        .returning()

      return result[0] ?? null
    },

    async rejectAgentWrite(writeId: string, tenantId: string, reviewedBy: string) {
      const result = await db
        .update(wikiAgentWrites)
        .set({
          status: 'rejected',
          reviewed_by: reviewedBy,
          reviewed_at: new Date(),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(wikiAgentWrites.id, writeId),
            eq(wikiAgentWrites.tenant_id, tenantId),
          ),
        )
        .returning()

      return result[0] ?? null
    },

    // ── Search (pgvector) ─────────────────────────────────
    async searchStrategicPages(tenantId: string, embedding: number[], limit = 5, threshold = 0.75) {
      const db2 = getDb()
      const vectorStr = `[${embedding.join(',')}]`
      const result = await db2.execute(
        sql`SELECT id, slug, title, type, content, confidence,
                   1 - (embedding <=> ${vectorStr}::vector) AS similarity
            FROM wiki_strategic_pages
            WHERE tenant_id = ${tenantId}
              AND status = 'ativo'
              AND embedding IS NOT NULL
              AND 1 - (embedding <=> ${vectorStr}::vector) > ${threshold}
            ORDER BY embedding <=> ${vectorStr}::vector
            LIMIT ${limit}`,
      )
      return result.rows
    },
  }
}
