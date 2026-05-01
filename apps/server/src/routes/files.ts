import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import multipart from '@fastify/multipart'
import { randomUUID } from 'crypto'
import { eq, and, desc, sql } from 'drizzle-orm'
import { getDb, files, tenants, auditLog } from '@ethra-nexus/db'
import { createStorageDriver } from '@ethra-nexus/agents'
import { sanitizeForHtml, validateMimeType, validateExpiresAt } from '@ethra-nexus/core'

declare module 'fastify' {
  interface FastifyRequest {
    userSlug?: string
    userRole?: 'admin' | 'member'
  }
}

async function requireFilesAccess(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { tenantId?: string; slug?: string; role?: string } | undefined
  if (!user?.slug) return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing JWT' })
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'Files API is admin-only' })
  }
  request.userSlug = user.slug
  request.userRole = user.role as 'admin' | 'member'
}

async function getCurrentUsage(tenantId: string): Promise<number> {
  const db = getDb()
  const rows = await db.execute(sql`
    SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
    FROM files
    WHERE tenant_id = ${tenantId}
      AND (expires_at IS NULL OR expires_at > NOW())
  `)
  const row = rows.rows[0] as { total: number | string }
  return typeof row.total === 'string' ? parseInt(row.total, 10) : row.total
}

export async function fileRoutes(app: FastifyInstance) {
  // Register multipart only if not already registered
  if (!app.hasContentTypeParser('multipart/form-data')) {
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
  }
  app.addHook('preHandler', requireFilesAccess)

  // POST /files
  app.post('/files', async (request, reply) => {
    const driver = createStorageDriver()
    const db = getDb()

    const part = await (request as unknown as { file: () => Promise<unknown> }).file()
    if (!part) return reply.status(400).send({ error: 'INVALID_FILE', message: 'Missing file field' })

    const fileLike = part as {
      filename?: string
      mimetype?: string
      toBuffer: () => Promise<Buffer>
      fields?: Record<string, { value?: string }>
    }

    const original_filename_raw = fileLike.filename ?? 'unnamed'
    const original_filename = sanitizeForHtml(original_filename_raw).slice(0, 255)

    let mime_type: string
    try { mime_type = validateMimeType(fileLike.mimetype ?? 'application/octet-stream') }
    catch (e) { return reply.status(400).send({ error: 'INVALID_FILE', message: (e as Error).message }) }

    const expires_at_raw = fileLike.fields?.['expires_at']?.value
    let expires_at: Date | null
    try { expires_at = validateExpiresAt(expires_at_raw ?? null) }
    catch (e) { return reply.status(400).send({ error: 'INVALID_FILE', message: (e as Error).message }) }

    const buf = await fileLike.toBuffer()
    const size_bytes = buf.length

    // Quota pre-check
    const tenantRows = await db.select({ limit: tenants.storage_limit_bytes })
      .from(tenants)
      .where(eq(tenants.id, request.tenantId))
      .limit(1)
    const limit = tenantRows[0]?.limit ?? null
    if (limit !== null) {
      const current = await getCurrentUsage(request.tenantId)
      if (current + size_bytes > limit) {
        return reply.status(413).send({
          error: 'STORAGE_LIMIT_EXCEEDED',
          message: `Tenant would exceed storage_limit_bytes (${current} + ${size_bytes} > ${limit})`,
        })
      }
    }

    // Generate file_id and persist via driver
    const file_id = randomUUID()
    let putResult: { storage_key: string; size_bytes: number; sha256: string }
    try {
      putResult = await driver.put({ tenant_id: request.tenantId, file_id, bytes: buf, mime_type })
    } catch (e) {
      request.log.error({ err: e }, 'storage driver put failed')
      return reply.status(500).send({ error: 'STORAGE_DRIVER_ERROR', message: 'Failed to persist bytes' })
    }

    // Insert DB row; rollback on failure
    let inserted_id: string
    try {
      const rows = await db.insert(files).values({
        id: file_id,
        tenant_id: request.tenantId,
        storage_key: putResult.storage_key,
        mime_type,
        size_bytes: putResult.size_bytes,
        sha256: putResult.sha256,
        original_filename,
        uploaded_by: request.userSlug!,
        expires_at,
      }).returning({ id: files.id })
      inserted_id = (rows[0]?.id ?? file_id) as string

      await db.insert(auditLog).values({
        tenant_id: request.tenantId,
        entity_type: 'file',
        entity_id: inserted_id,
        action: 'create',
        actor: request.userSlug!,
        payload: { mime_type, size_bytes: putResult.size_bytes, original_filename },
        user_ip: request.ip,
      })
    } catch (e) {
      await driver.delete(putResult.storage_key).catch(() => undefined)
      request.log.error({ err: e }, 'files insert failed; rolled back driver')
      return reply.status(500).send({ error: 'DB_ERROR', message: 'Failed to record file' })
    }

    const download_url = await driver.getDownloadUrl(putResult.storage_key)
    return reply.status(201).send({
      id: inserted_id,
      original_filename,
      mime_type,
      size_bytes: putResult.size_bytes,
      sha256: putResult.sha256,
      download_url,
      expires_at: expires_at?.toISOString() ?? null,
    })
  })

  // GET /files/:id/download
  app.get<{ Params: { id: string } }>('/files/:id/download', async (request, reply) => {
    const db = getDb()
    const driver = createStorageDriver()
    const rows = await db.select({
      storage_key: files.storage_key,
      mime_type: files.mime_type,
      original_filename: files.original_filename,
    }).from(files)
      .where(and(eq(files.id, request.params.id), eq(files.tenant_id, request.tenantId)))
      .limit(1)

    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'FILE_NOT_FOUND', message: 'File not found' })

    const stream = await driver.get(row.storage_key)
    if (!stream) {
      request.log.error({ storage_key: row.storage_key }, 'STORAGE_ORPHAN — db row without driver bytes')
      return reply.status(500).send({ error: 'STORAGE_ORPHAN', message: 'File metadata exists but bytes missing' })
    }

    const filename = row.original_filename ?? 'file'
    reply.header('Content-Type', row.mime_type)
    reply.header('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
    return reply.send(stream)
  })

  // GET /files (list with optional filters)
  app.get<{ Querystring: { limit?: string; offset?: string; mime_type?: string } }>(
    '/files',
    async (request) => {
      const db = getDb()
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10) || 50, 1), 200)
      const offset = Math.max(parseInt(request.query.offset ?? '0', 10) || 0, 0)

      const where = request.query.mime_type
        ? and(eq(files.tenant_id, request.tenantId), eq(files.mime_type, request.query.mime_type))
        : eq(files.tenant_id, request.tenantId)

      const rows = await db.select({
        id: files.id,
        original_filename: files.original_filename,
        mime_type: files.mime_type,
        size_bytes: files.size_bytes,
        sha256: files.sha256,
        expires_at: files.expires_at,
        created_at: files.created_at,
      })
        .from(files)
        .where(where)
        .orderBy(desc(files.created_at))
        .limit(limit)
        .offset(offset)

      return { data: rows }
    },
  )

  // DELETE /files/:id
  app.delete<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
    const db = getDb()
    const driver = createStorageDriver()

    const rows = await db.select({ storage_key: files.storage_key })
      .from(files)
      .where(and(eq(files.id, request.params.id), eq(files.tenant_id, request.tenantId)))
      .limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'FILE_NOT_FOUND', message: 'File not found' })

    await db.delete(files).where(eq(files.id, request.params.id))
    await driver.delete(row.storage_key).catch((e) => {
      request.log.warn({ err: e }, 'driver.delete failed; row already removed (orphan in storage)')
    })
    await db.insert(auditLog).values({
      tenant_id: request.tenantId,
      entity_type: 'file',
      entity_id: request.params.id,
      action: 'delete',
      actor: request.userSlug!,
      payload: {},
      user_ip: request.ip,
    })

    return reply.status(204).send()
  })
}
