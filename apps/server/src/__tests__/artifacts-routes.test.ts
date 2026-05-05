import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'

const dbSelectMock = vi.fn()
const driverGetMock = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({ limit: () => dbSelectMock() }),
      }),
    })),
  }),
  artifacts: {
    _: { name: 'artifacts' },
    id: 'artifacts.id',
    tenant_id: 'artifacts.tenant_id',
    storage_key: 'artifacts.storage_key',
    mime_type: 'artifacts.mime_type',
    title: 'artifacts.title',
    expires_at: 'artifacts.expires_at',
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
}))
vi.mock('@ethra-nexus/agents', async () => {
  const actual = await vi.importActual<typeof import('@ethra-nexus/agents')>('@ethra-nexus/agents')
  return {
    ...actual,
    createStorageDriver: () => ({
      get: driverGetMock,
      put: vi.fn(),
      delete: vi.fn(),
      getDownloadUrl: vi.fn(),
    }),
  }
})

import { artifactsRoutes } from '../routes/artifacts'

beforeEach(() => {
  dbSelectMock.mockReset()
  driverGetMock.mockReset()
})

async function buildApp() {
  const app = Fastify()
  app.decorateRequest('tenantId', null as unknown as string)
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { tenantId: string }).tenantId = 't1'
  })
  await artifactsRoutes(app)
  return app
}

function makeReadable(buf: Buffer): NodeJS.ReadableStream {
  const { Readable } = require('node:stream') as typeof import('node:stream')
  return Readable.from([buf])
}

describe('GET /artifacts/:id/view', () => {
  it('returns 200 + html content + CSP header on valid request', async () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000)
    dbSelectMock.mockResolvedValueOnce([{
      storage_key: 't1/artifacts/a1', mime_type: 'text/html',
      title: 'Dashboard', expires_at: future,
    }])
    driverGetMock.mockResolvedValueOnce(makeReadable(Buffer.from('<!DOCTYPE html><html></html>')))

    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/artifacts/00000000-0000-0000-0000-000000000001/view',
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/)
    expect(res.headers['content-security-policy']).toMatch(/connect-src 'none'/)
    expect(res.headers['content-disposition']).toMatch(/inline/)
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body).toContain('<!DOCTYPE html>')
  })

  it('returns 404 ARTIFACT_NOT_FOUND when row missing', async () => {
    dbSelectMock.mockResolvedValueOnce([])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/artifacts/00000000-0000-0000-0000-000000000099/view',
    })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'ARTIFACT_NOT_FOUND' })
  })

  it('returns 410 ARTIFACT_EXPIRED when expires_at is past', async () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000)
    dbSelectMock.mockResolvedValueOnce([{
      storage_key: 't1/artifacts/a1', mime_type: 'text/html',
      title: 'Old', expires_at: past,
    }])
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/artifacts/00000000-0000-0000-0000-000000000001/view',
    })
    expect(res.statusCode).toBe(410)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'ARTIFACT_EXPIRED' })
  })

  it('returns 500 STORAGE_ORPHAN when driver.get returns null', async () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000)
    dbSelectMock.mockResolvedValueOnce([{
      storage_key: 't1/artifacts/a1', mime_type: 'text/html',
      title: 'X', expires_at: future,
    }])
    driverGetMock.mockResolvedValueOnce(null)
    const app = await buildApp()
    const res = await app.inject({
      method: 'GET',
      url: '/artifacts/00000000-0000-0000-0000-000000000001/view',
    })
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'STORAGE_ORPHAN' })
  })
})
