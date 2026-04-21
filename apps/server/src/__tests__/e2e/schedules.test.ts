// apps/server/src/__tests__/e2e/schedules.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('@ethra-nexus/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ethra-nexus/agents')>()
  return { ...mod, startSchedulerLoop: vi.fn() }
})

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TEST_AGENT_ID  = '00000000-0000-0000-0001-000000000001'

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Schedules endpoints', () => {
  let app: FastifyInstance
  let token: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any

  beforeAll(async () => {
    db = await import('@ethra-nexus/db')
    const { buildApp } = await import('../../app')
    app = await buildApp()
    await app.ready()
    token = await app.jwt.sign({ tenantId: TEST_TENANT_ID, email: 'test@test.com', role: 'admin' })
  })

  afterAll(async () => { await app.close() })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.scheduledResults).where(db.eq(db.scheduledResults.tenant_id, TEST_TENANT_ID))
    await drizzle.delete(db.agentSchedules).where(db.eq(db.agentSchedules.tenant_id, TEST_TENANT_ID))
  })

  describe('POST /api/v1/schedules — criação e validação', () => {
    it('cria schedule válido e retorna next_run_at calculado', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/schedules',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          agent_id: TEST_AGENT_ID,
          skill_id: 'wiki:lint',
          cron_expression: '0 9 * * 1-5',
          timezone: 'America/Sao_Paulo',
        },
      })

      expect(response.statusCode).toBe(201)
      const body = response.json<{ data: { id: string; next_run_at: string; enabled: boolean } }>()
      expect(body.data.id).toBeTruthy()
      expect(body.data.next_run_at).toBeTruthy()
      expect(body.data.enabled).toBe(true)
      expect(new Date(body.data.next_run_at).getTime()).toBeGreaterThan(Date.now())
    })

    it('rejeita cron_expression inválida com 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/schedules',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          agent_id: TEST_AGENT_ID,
          skill_id: 'wiki:lint',
          cron_expression: 'isso não é cron',
        },
      })

      expect(response.statusCode).toBe(400)
      const body = response.json<{ error: string }>()
      expect(body.error).toContain('cron_expression')
    })
  })

  describe('PATCH /api/v1/schedules/:id/disable e /enable', () => {
    it('desabilita e reabilita schedule', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/schedules',
        headers: { Authorization: `Bearer ${token}` },
        payload: { agent_id: TEST_AGENT_ID, skill_id: 'wiki:lint', cron_expression: '*/5 * * * *' },
      })
      const scheduleId = createRes.json<{ data: { id: string } }>().data.id

      const disableRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/schedules/${scheduleId}/disable`,
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(disableRes.statusCode).toBe(200)
      expect(disableRes.json<{ data: { enabled: boolean } }>().data.enabled).toBe(false)

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/schedules/${scheduleId}`,
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(getRes.json<{ data: { enabled: boolean } }>().data.enabled).toBe(false)

      const enableRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/schedules/${scheduleId}/enable`,
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(enableRes.json<{ data: { enabled: boolean } }>().data.enabled).toBe(true)
    })
  })

  describe('GET /api/v1/schedules', () => {
    it('lista schedules do tenant', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/schedules',
        headers: { Authorization: `Bearer ${token}` },
        payload: { agent_id: TEST_AGENT_ID, skill_id: 'wiki:lint', cron_expression: '*/5 * * * *' },
      })

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/schedules',
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ data: unknown[] }>()
      expect(body.data.length).toBeGreaterThan(0)
    })
  })
})
