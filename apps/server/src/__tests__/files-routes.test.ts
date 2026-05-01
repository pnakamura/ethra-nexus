import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

// Mock @ethra-nexus/db with a stubbed db
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  execute: vi.fn(),
}
vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  files: { id: 'id', tenant_id: 'tenant_id', storage_key: 'storage_key', mime_type: 'mime_type', size_bytes: 'size_bytes', sha256: 'sha256', original_filename: 'original_filename', uploaded_by: 'uploaded_by', expires_at: 'expires_at', created_at: 'created_at' },
  tenants: { id: 'id', storage_limit_bytes: 'storage_limit_bytes' },
  auditLog: { tenant_id: 'tenant_id', entity_type: 'entity_type', entity_id: 'entity_id', action: 'action', actor: 'actor', payload: 'payload', user_ip: 'user_ip' },
}))

vi.mock('@ethra-nexus/core', () => ({
  sanitizeForHtml: vi.fn((s: string) => s),
  validateMimeType: vi.fn((s: string) => s),
  validateExpiresAt: vi.fn((s: string | null | undefined) => (s ? new Date(s) : null)),
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  or: vi.fn((...c) => ({ c })),
  isNull: vi.fn((c) => ({ isnull: c })),
  isNotNull: vi.fn((c) => ({ isnotnull: c })),
  gt: vi.fn((c, v) => ({ gt: { c, v } })),
  lt: vi.fn((c, v) => ({ lt: { c, v } })),
  desc: vi.fn((c) => ({ desc: c })),
  asc: vi.fn((c) => ({ asc: c })),
  sql: vi.fn((...args) => ({ sql: args })),
}))

// Mock storage driver
const mockDriver = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  getDownloadUrl: vi.fn(),
}
vi.mock('@ethra-nexus/agents', () => ({
  createStorageDriver: () => mockDriver,
}))

const { fileRoutes } = await import('../routes/files')

async function buildApp(userSlug: string, tenantId: string, role: 'admin' | 'member' = 'admin'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register((await import('@fastify/multipart')).default)
  app.addHook('onRequest', async (request) => {
    request.tenantId = tenantId
    ;(request as { user?: { tenantId: string; slug: string; role: string } }).user = {
      tenantId, slug: userSlug, role,
    }
  })
  await app.register(fileRoutes, { prefix: '/api/v1' })
  return app
}

describe('POST /api/v1/files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects with 403 when role is not admin', async () => {
    const app = await buildApp('user-slug', 'tenant-1', 'member')
    // Send a valid multipart body so content-type parser runs; role check fires in preHandler
    const boundary = '------ForbidBoundary'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="nope.txt"',
      'Content-Type: text/plain',
      '',
      'nope',
      `--${boundary}--`, '',
    ].join('\r\n')
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 413 when upload exceeds tenant storage_limit_bytes', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    // Tenant has 1000 bytes limit, currently using 800
    mockDb.select
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ limit: 1000 }]) }) }) })  // tenant lookup (select { limit: tenants.storage_limit_bytes })
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ total: 800 }] })  // getCurrentUsage raw SQL

    // Build a multipart body with 300 bytes of payload (would push to 1100)
    const boundary = '------TestBoundary'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="big.bin"',
      'Content-Type: application/octet-stream',
      '',
      'X'.repeat(300),
      `--${boundary}--`, '',
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toBe('STORAGE_LIMIT_EXCEEDED')
    // Driver must NOT have been called
    expect(mockDriver.put).not.toHaveBeenCalled()
  })

  it('returns 201 with file metadata on successful upload', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    // null limit = no quota enforcement
    mockDb.select
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ limit: null }]) }) }) })  // tenant lookup: no limit

    mockDriver.put.mockResolvedValueOnce({
      storage_key: 'tenant-1/abc',
      size_bytes: 4,
      sha256: '88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589',
    })
    mockDriver.getDownloadUrl.mockResolvedValueOnce('/api/v1/files/abc/download')

    mockDb.insert.mockReturnValueOnce({
      values: () => ({ returning: () => Promise.resolve([{ id: 'abc' }]) }),
    })
    // audit_log insert
    mockDb.insert.mockReturnValueOnce({
      values: () => Promise.resolve(),
    })

    const boundary = '------TB'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="hi.txt"',
      'Content-Type: text/plain',
      '',
      'data',
      `--${boundary}--`, '',
    ].join('\r\n')

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    const json = res.json()
    expect(json.id).toBe('abc')
    expect(json.size_bytes).toBe(4)
    expect(json.sha256).toBe('88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589')
    expect(json.download_url).toBe('/api/v1/files/abc/download')
    expect(mockDriver.put).toHaveBeenCalled()
  })
})

describe('GET /api/v1/files/:id/download', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('streams bytes with Content-Disposition: attachment', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{
        storage_key: 'tenant-1/abc', mime_type: 'text/plain', original_filename: 'file.txt',
      }]) }) })
    })
    const { Readable } = await import('stream')
    mockDriver.get.mockResolvedValueOnce(Readable.from(Buffer.from('hello')))

    const res = await app.inject({ method: 'GET', url: '/api/v1/files/abc/download' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('file.txt')
    expect(res.body).toBe('hello')
  })

  it('returns 404 when file does not exist or tenant mismatches', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) })
    })
    const res = await app.inject({ method: 'GET', url: '/api/v1/files/missing/download' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('FILE_NOT_FOUND')
  })

  it('returns 500 STORAGE_ORPHAN when row exists but driver get returns null', async () => {
    const app = await buildApp('s', 'tenant-1', 'admin')
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{
        storage_key: 'tenant-1/abc', mime_type: 'text/plain', original_filename: 'file.txt',
      }]) }) })
    })
    mockDriver.get.mockResolvedValueOnce(null)

    const res = await app.inject({ method: 'GET', url: '/api/v1/files/abc/download' })
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toBe('STORAGE_ORPHAN')
  })
})
