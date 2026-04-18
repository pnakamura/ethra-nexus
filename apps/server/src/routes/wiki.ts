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

interface CheckNewBody {
  files: Array<{ source_url: string; modified_time: string }>
}

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

interface IngestStreamQuery {
  file_type: string
  source_name: string
  source_url?: string
  source_origin?: string
}

type SourceOrigin = 'api' | 'google_drive' | 'upload' | 'n8n'

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

type IngestResult = {
  source_id: string
  pages_extracted: number
  pages_persisted: number
  pages_embedded: number
  pages_failed: number
  invalid_from_llm: unknown
  failed_persistence: string[]
  log_entry: unknown
}

type IngestError = { status: number; body: object }

async function runIngestFromBuffer(
  wikiDb: ReturnType<typeof createWikiDb>,
  tenantId: string,
  buffer: Buffer,
  params: {
    file_type: FileType
    source_name: string
    source_url?: string
    source_origin: SourceOrigin
  },
  log: Pick<FastifyInstance['log'], 'warn' | 'error'>,
): Promise<{ error: IngestError } | { result: IngestResult }> {
  const db = getDb()

  const insertResult = await db
    .insert(wikiRawSources)
    .values({
      tenant_id: tenantId,
      name: params.source_name,
      file_type: params.file_type,
      source_url: params.source_url ?? null,
      source_origin: params.source_origin,
      status: 'processing',
    })
    .returning({ id: wikiRawSources.id })
  const rawSource = insertResult[0]
  if (!rawSource) throw new Error('wiki_raw_sources insert returned no rows')

  const updateSource = async (
    status: 'done' | 'failed',
    extra: { pages_extracted?: number; pages_persisted?: number; error_msg?: string },
  ) => {
    await db
      .update(wikiRawSources)
      .set({ status, ingested_at: new Date(), ...extra })
      .where(sql`id = ${rawSource.id}`)
  }

  let text: string
  try {
    text = await parseBuffer(buffer, params.file_type)
  } catch (err) {
    await updateSource('failed', { error_msg: (err as Error).message })
    return { error: { status: 400, body: { error: 'Failed to parse file', details: (err as Error).message } } }
  }

  if (text.trim().length < 50) {
    await updateSource('failed', { error_msg: 'Parsed content is too short (< 50 chars)' })
    return { error: { status: 400, body: { error: 'Parsed content is too short (< 50 chars)' } } }
  }

  const providerRegistry = createRegistryFromEnv()
  let extraction: Awaited<ReturnType<typeof extractPagesFromContent>>
  try {
    extraction = await extractPagesFromContent(text, params.source_name, providerRegistry)
  } catch (err) {
    log.error({ err: (err as Error).message }, 'LLM extraction failed')
    await updateSource('failed', { error_msg: `LLM: ${(err as Error).message}` })
    return { error: { status: 502, body: { error: 'LLM extraction failed', details: (err as Error).message } } }
  }

  let persisted = 0
  let embeddedOk = 0
  const failedPages: string[] = []

  for (const extractedPage of extraction.pages) {
    try {
      const page = await wikiDb.upsertStrategicPage({
        tenant_id: tenantId,
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

      const embedStatus = await regenerateEmbedding(page.id, `${page.title}\n\n${page.content}`)
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
    result: {
      source_id: rawSource.id,
      pages_extracted: extraction.pages.length,
      pages_persisted: persisted,
      pages_embedded: embeddedOk,
      pages_failed: failedPages.length,
      invalid_from_llm: extraction.invalid_reasons,
      failed_persistence: failedPages,
      log_entry: extraction.log_entry,
    },
  }
}

const VALID_ORIGINS: SourceOrigin[] = ['api', 'google_drive', 'upload', 'n8n']

export async function wikiRoutes(app: FastifyInstance) {
  const wikiDb = createWikiDb()

  // Parser para binary types — usado por /wiki/ingest/stream (N8N filesystem mode)
  app.addContentTypeParser(
    ['application/pdf', 'application/octet-stream',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  )

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
  // Toda ingestão é registrada em wiki_raw_sources para rastreabilidade LGPD.
  app.post<{ Body: IngestBody }>('/wiki/ingest', async (request, reply) => {
    const { content_base64, file_type, source_name, source_url, source_origin = 'api' } = request.body
    if (!content_base64 || !file_type || !source_name) {
      return reply
        .status(400)
        .send({ error: 'content_base64, file_type and source_name are required' })
    }

    const buffer = Buffer.from(content_base64, 'base64')
    const out = await runIngestFromBuffer(wikiDb, request.tenantId, buffer, {
      file_type,
      source_name,
      source_url,
      source_origin,
    }, request.log)

    if ('error' in out) return reply.status(out.error.status).send(out.error.body)
    return out.result
  })

  // ── POST /wiki/ingest/stream ──────────────────────────────
  // Aceita binário raw no body + metadados via query params.
  // Usado pelo N8N com binaryDataMode: filesystem, onde expressões
  // não conseguem serializar $binary.data — mas specifyBody:"binaryData"
  // usa getBinaryDataBuffer() internamente e funciona corretamente.
  app.post<{ Querystring: IngestStreamQuery }>('/wiki/ingest/stream', async (request, reply) => {
    const { file_type, source_name, source_url, source_origin = 'google_drive' } = request.query

    if (!file_type || !source_name) {
      return reply.status(400).send({ error: 'file_type and source_name query params are required' })
    }

    const origin: SourceOrigin = VALID_ORIGINS.includes(source_origin as SourceOrigin)
      ? (source_origin as SourceOrigin)
      : 'google_drive'

    const buffer = request.body as Buffer
    if (!buffer || buffer.length === 0) {
      return reply.status(400).send({ error: 'Empty request body' })
    }

    const out = await runIngestFromBuffer(wikiDb, request.tenantId, buffer, {
      file_type: file_type as FileType,
      source_name,
      source_url,
      source_origin: origin,
    }, request.log)

    if ('error' in out) return reply.status(out.error.status).send(out.error.body)
    return out.result
  })

  // ── POST /wiki/sources/check-new ─────────────────────────
  // Recebe lista de {source_url, modified_time} e retorna quais
  // devem ser processados (novos ou atualizados desde último ingest).
  app.post<{ Body: CheckNewBody }>('/wiki/sources/check-new', async (request, _reply) => {
    const { files } = request.body
    if (!files?.length) {
      return { to_process: [], to_skip: [] }
    }

    // Busca todos os sources já ingeridos com sucesso para este tenant
    const result = await getDb().execute(
      sql`SELECT source_url, MAX(ingested_at) AS last_ingested_at
          FROM wiki_raw_sources
          WHERE tenant_id = ${request.tenantId}
            AND status = 'done'
            AND source_url IS NOT NULL
          GROUP BY source_url`,
    )

    const ingested = new Map<string, Date>()
    for (const row of result.rows as Array<{ source_url: string; last_ingested_at: string | null }>) {
      if (row.source_url && row.last_ingested_at) {
        ingested.set(row.source_url, new Date(row.last_ingested_at))
      }
    }

    const to_process: Array<{ source_url: string; reason: 'new' | 'updated' }> = []
    const to_skip: Array<{ source_url: string; last_ingested_at: string }> = []

    for (const file of files) {
      if (!file.source_url) continue
      const lastIngested = ingested.get(file.source_url)
      if (!lastIngested) {
        to_process.push({ source_url: file.source_url, reason: 'new' })
      } else if (new Date(file.modified_time) > lastIngested) {
        to_process.push({ source_url: file.source_url, reason: 'updated' })
      } else {
        to_skip.push({ source_url: file.source_url, last_ingested_at: lastIngested.toISOString() })
      }
    }

    return { to_process, to_skip }
  })

  // ── POST /wiki/pages/:id/reembed ──────────────────────────
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
