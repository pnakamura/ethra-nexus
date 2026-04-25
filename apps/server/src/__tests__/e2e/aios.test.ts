// apps/server/src/__tests__/e2e/aios.test.ts
// Requires DATABASE_URL_TEST to be set — all describe blocks are skipped otherwise.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

// vi.mock must be at top level for Vitest hoisting — the factory runs lazily
vi.mock('@ethra-nexus/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ethra-nexus/agents')>()
  return {
    ...mod,
    startSchedulerLoop: vi.fn(),
    // CI has no ANTHROPIC_API_KEY, so the real executeTask would throw at provider init.
    executeTask: vi.fn().mockResolvedValue({
      ok: true,
      data: { answer: 'mocked wiki:lint response' },
      agent_id: '00000000-0000-0000-0001-000000000001',
      skill_id: 'wiki:lint',
      timestamp: new Date().toISOString(),
      tokens_used: 100,
      cost_usd: 0.01,
    }),
  }
})

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TEST_AGENT_ID  = '00000000-0000-0000-0001-000000000001'

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: AIOS endpoints', () => {
  let app: FastifyInstance
  let token: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any

  beforeAll(async () => {
    // Lazy imports — only executed when DATABASE_URL_TEST is set.
    // buildApp imports fastify which is only in root node_modules.
    db = await import('@ethra-nexus/db')
    const { buildApp } = await import('../../app')
    app = await buildApp()
    await app.ready()
    token = await app.jwt.sign({ tenantId: TEST_TENANT_ID, email: 'test@test.com', role: 'admin' })
  })

  afterAll(async () => { await app.close() })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.aiosEvents).where(db.eq(db.aiosEvents.tenant_id, TEST_TENANT_ID))
  })

  describe('POST /api/v1/aios/execute', () => {
    it('retorna 200 com answer, tokens_used e cost_usd ao executar wiki:lint', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/aios/execute',
        headers: { Authorization: `Bearer ${token}` },
        payload: { agent_id: TEST_AGENT_ID, skill_id: 'wiki:lint', input: {} },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ data: { answer: string }; tokens_used: number; cost_usd: number }>()
      expect(typeof body.data.answer).toBe('string')
      expect(typeof body.tokens_used).toBe('number')
      expect(typeof body.cost_usd).toBe('number')
    })

    it('retorna 400 quando campos obrigatórios estão ausentes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/aios/execute',
        headers: { Authorization: `Bearer ${token}` },
        payload: { agent_id: TEST_AGENT_ID },
      })

      expect(response.statusCode).toBe(400)
    })

    it('retorna 401 sem Authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/aios/execute',
        payload: { agent_id: TEST_AGENT_ID, skill_id: 'wiki:lint', input: {} },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe('GET /api/v1/aios/events', () => {
    it('retorna lista de eventos do tenant', async () => {
      // executeTask is mocked, so insert an event directly to exercise the GET.
      const drizzle = db.getDb()
      await drizzle.insert(db.aiosEvents).values({
        tenant_id: TEST_TENANT_ID,
        agent_id: TEST_AGENT_ID,
        skill_id: 'wiki:lint',
        activation_mode: 'on_demand',
        payload: {},
        status: 'completed',
      })

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/aios/events',
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ data: unknown[] }>()
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
    })
  })
})
