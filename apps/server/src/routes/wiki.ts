import type { FastifyInstance } from 'fastify'
import { sql } from 'drizzle-orm'
import { getDb, wikiRawSources } from '@ethra-nexus/db'
import {
  embed,
  generateStrategicIndex,
  extractPagesFromContent,
} from '@ethra-nexus/wiki'
import type { FileType } from '@ethra-nexus/agents'
import { createWikiDb, createRegistryFromEnv, parseBuffer } from '@ethra-nexus/agents'

// ============================================================
// Wiki Routes — Sub-fase 5a (Opção A: index.md primário)
//
// Endpoints:
//   POST /wiki/pages             — humano cria/atualiza página estratégica
//   GET  /wiki/index/strategic   — index Markdown (LLM lê para decidir)
//   POST /wiki/search            — RAG fallback via pgvector
//
// Decisão de design: criação de página é a operação primária.
// Embedding é best-effort — falha em embedding NÃO falha o request.
// Página fica acessível via index.md mesmo sem busca semântica.
// ============================================================

interface CreatePageBody {
  slug: string
  title: string
  content: string
  type?: string
  confidence?: string
  sources?: string[]
  tags?: string[]
}

interface SearchBody {
  query: string
  limit?: number
  threshold?: number
}

interface IngestBody {
  content_base64: string
  file_type: FileType
  source_name: string
  source_url?: string
  source_origin?: 'api' | 'google_drive' | 'upload' | 'n8n'
}

async function regenerateEmbedding(
  pageId: string,
  text: string,
): Promise<{ status: 'ok' | 'failed'; error?: string }> {
  try {
    const vector = await embed(text)
    const vectorStr = `[${vector.join(',')}]`
    await getDb().execute(
      sql`UPDATE wiki_strategic_pages
          SET embedding = ${vectorStr}::vector
          WHERE id = ${pageId}`,
    )
    return { status: 'ok' }
  } catch (err) {
    return { status: 'failed', error: (err as Error).message }
  }
}

export async function wikiRoutes(app: FastifyInstance) {
  const wikiDb = createWikiDb()

  // ── POST /wiki/pages ───────────────────────────────────────
  app.post<{ Body: CreatePageBody }>('/wiki/pages', async (request, reply) => {
    const body = request.body
    if (!body.slug || !body.title || !body.content) {
      return reply.status(400).send({ error: 'slug, title and content are required' })
    }

    const page = await wikiDb.upsertStrategicPage({
      tenant_id: request.tenantId,
      slug: body.slug,
      title: body.title,
      type: body.type ?? 'conceito',
      content: body.content,
      sources: body.sources ?? [],
      tags: body.tags ?? [],
      confidence: body.confidence ?? 'alta',
      author_type: 'human',
    })

    const embedding = await regenerateEmbedding(page.id, `${page.title}\n\n${page.content}`)
    if (embedding.status === 'failed') {
      request.log.warn(
        { pageId: page.id, error: embedding.error },
        'embedding generation failed; page persisted without semantic search',
      )
    }

    return reply.status(201).send({
      data: { id: page.id, slug: page.slug, title: page.title, type: page.type },
      embedding_status: embedding.status,
    })
  })

  // ── GET /wiki/index/strategic ──────────────────────────────
  app.get('/wiki/index/strategic', async (request, reply) => {
    const pages = await wikiDb.getStrategicPages(request.tenantId)
    const markdown = generateStrategicIndex(
      pages.map((p) => ({
        slug: p.slug,
        title: p.title,
        type: p.type,
        confidence: p.confidence,
      })),
    )
    reply.type('text/markdown').send(markdown)
  })

  // ── POST /wiki/search ──────────────────────────────────────
  app.post<{ Body: SearchBody }>('/wiki/search', async (request, reply) => {
    // threshold 0.3 é adequado para text-embedding-3-small (scores menores que ada-002)
    const { query, limit = 5, threshold = 0.3 } = request.body
    if (!query) {
      return reply.status(400).send({ error: 'query is required' })
    }

    let queryEmbedding: number[]
    try {
      queryEmbedding = await embed(query)
    } catch (err) {
      request.log.error({ err: (err as Error).message }, 'search embedding failed')
      return reply.status(503).send({
        error: 'Embedding service unavailable',
        message: 'Use GET /wiki/index/strategic as fallback',
      })
    }

    const vectorStr = `[${queryEmbedding.join(',')}]`
    const result = await getDb().execute(
      sql`SELECT id, slug, title, type, confidence,
                 1 - (embedding <=> ${vectorStr}::vector) AS similarity
          FROM wiki_strategic_pages
          WHERE tenant_id = ${request.tenantId}
            AND status = 'ativo'
            AND embedding IS NOT NULL
            AND 1 - (embedding <=> ${vectorStr}::vector) > ${threshold}
          ORDER BY embedding <=> ${vectorStr}::vector
          LIMIT ${limit}`,
    )

    return { data: result.rows }
  })

  // ── POST /wiki/ingest ─────────────────────────────────────
  // Recebe documento bruto (base64), LLM extrai N páginas estruturadas.
  // Cada página é upserted individualmente + embedding best-effort.
  // Toda ingestão é registrada em wiki_raw_sources para rastreabilidade LGPD.
  app.post<{ Body: IngestBody }>('/wiki/ingest', async (request, reply) => {
    const { content_base64, file_type, source_name, source_url, source_origin = 'api' } = request.body
    if (!content_base64 || !file_type || !source_name) {
      return reply
        .status(400)
        .send({ error: 'content_base64, file_type and source_name are required' })
    }

    // Registra a fonte imediatamente (audit trail LGPD)
    const db = getDb()
    const [rawSource] = await db
      .insert(wikiRawSources)
      .values({
        tenant_id: request.tenantId,
        name: source_name,
        file_type,
        source_url: source_url ?? null,
        source_origin,
        status: 'processing',
      })
      .returning({ id: wikiRawSources.id })

    const updateSource = async (
      status: 'done' | 'failed',
      extra: { pages_extracted?: number; pages_persisted?: number; error_msg?: string },
    ) => {
      await db
        .update(wikiRawSources)
        .set({ status, ingested_at: new Date(), ...extra })
        .where(sql`id = ${rawSource.id}`)
    }

    // 1. Decode + parse
    let text: string
    try {
      const buffer = Buffer.from(content_base64, 'base64')
      text = await parseBuffer(buffer, file_type)
    } catch (err) {
      await updateSource('failed', { error_msg: (err as Error).message })
      return reply
        .status(400)
        .send({ error: 'Failed to parse file', details: (err as Error).message })
    }

    if (text.trim().length < 50) {
      await updateSource('failed', { error_msg: 'Parsed content is too short (< 50 chars)' })
      return reply.status(400).send({ error: 'Parsed content is too short (< 50 chars)' })
    }

    // 2. LLM extraction (Anthropic Sonnet — LGPD)
    const providerRegistry = createRegistryFromEnv()
    let extraction: Awaited<ReturnType<typeof extractPagesFromContent>>
    try {
      extraction = await extractPagesFromContent(text, source_name, providerRegistry)
    } catch (err) {
      request.log.error({ err: (err as Error).message }, 'LLM extraction failed')
      await updateSource('failed', { error_msg: `LLM: ${(err as Error).message}` })
      return reply
        .status(502)
        .send({ error: 'LLM extraction failed', details: (err as Error).message })
    }

    // 3. Upsert cada página (best-effort)
    let persisted = 0
    let embeddedOk = 0
    const failedPages: string[] = []

    for (const extractedPage of extraction.pages) {
      try {
        const page = await wikiDb.upsertStrategicPage({
          tenant_id: request.tenantId,
          slug: extractedPage.slug,
          title: extractedPage.title,
          type: extractedPage.type,
          content: extractedPage.content,
          sources: extractedPage.sources,
          tags: extractedPage.tags,
          confidence: extractedPage.confidence,
          author_type: 'agent',
        })
        persisted++

        const embedStatus = await regenerateEmbedding(
          page.id,
          `${page.title}\n\n${page.content}`,
        )
        if (embedStatus.status === 'ok') embeddedOk++
      } catch (err) {
        failedPages.push(`${extractedPage.slug}: ${(err as Error).message}`)
      }
    }

    await updateSource('done', {
      pages_extracted: extraction.pages.length,
      pages_persisted: persisted,
    })

    return {
      source_id: rawSource.id,
      pages_extracted: extraction.pages.length,
      pages_persisted: persisted,
      pages_embedded: embeddedOk,
      pages_failed: failedPages.length,
      invalid_from_llm: extraction.invalid_reasons,
      failed_persistence: failedPages,
      log_entry: extraction.log_entry,
    }
  })

  // ── POST /wiki/pages/:id/reembed ──────────────────────────
  // Re-tenta gerar embedding para uma página existente.
  // Útil quando OPENAI_API_KEY estava inválida no momento da criação.
  app.post<{ Params: { id: string } }>(
    '/wiki/pages/:id/reembed',
    async (request, reply) => {
      const result = await getDb().execute(
        sql`SELECT id, title, content FROM wiki_strategic_pages
            WHERE id = ${request.params.id} AND tenant_id = ${request.tenantId}
            LIMIT 1`,
      )
      const row = result.rows[0] as { id: string; title: string; content: string } | undefined
      if (!row) {
        return reply.status(404).send({ error: 'Page not found' })
      }

      const embedding = await regenerateEmbedding(row.id, `${row.title}\n\n${row.content}`)
      return reply.status(embedding.status === 'ok' ? 200 : 503).send(embedding)
    },
  )
}
