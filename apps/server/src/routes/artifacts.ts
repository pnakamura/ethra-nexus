import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { getDb, artifacts } from '@ethra-nexus/db'
import { createStorageDriver } from '@ethra-nexus/agents'

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' https://cdn.jsdelivr.net",
  "connect-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

export async function artifactsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/artifacts/:id/view', async (request, reply) => {
    const db = getDb()
    const driver = createStorageDriver()

    // Public route (Spec #4): UUID-only access, no tenant filter.
    // Security: artifact_id is a v4 UUID (~122 bits unguessable entropy);
    // expires_at TTL caps exposure window (7d default). Equivalent to
    // share-by-link model (Vercel/Google Drive). Tenant isolation
    // maintained because users only know URLs of their own artifacts.
    const rows = await db
      .select({
        storage_key: artifacts.storage_key,
        mime_type: artifacts.mime_type,
        title: artifacts.title,
        expires_at: artifacts.expires_at,
      })
      .from(artifacts)
      .where(eq(artifacts.id, request.params.id))
      .limit(1)

    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'ARTIFACT_NOT_FOUND' })
    if (row.expires_at < new Date()) {
      return reply.status(410).send({ error: 'ARTIFACT_EXPIRED', message: 'Artifact has expired' })
    }

    const stream = await driver.get(row.storage_key)
    if (!stream) {
      request.log.error({ storage_key: row.storage_key }, 'artifact storage_orphan')
      return reply.status(500).send({ error: 'STORAGE_ORPHAN' })
    }

    const safeFilename = row.title.replace(/[^\w\s-]/g, '_').slice(0, 100)
    reply.header('Content-Type', row.mime_type)
    reply.header('Content-Disposition', `inline; filename="${safeFilename}.html"`)
    reply.header('Content-Security-Policy', CSP)
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Cache-Control', 'private, max-age=300')

    return reply.send(stream)
  })
}
