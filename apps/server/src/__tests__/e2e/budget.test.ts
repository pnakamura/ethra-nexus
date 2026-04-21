// apps/server/src/__tests__/e2e/budget.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('@ethra-nexus/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ethra-nexus/agents')>()
  return { ...mod, startSchedulerLoop: vi.fn() }
})

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TEST_AGENT_ID  = '00000000-0000-0000-0001-000000000001'

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Budget enforcement', () => {
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
    const month = new Date().toISOString().slice(0, 7)
    await drizzle.delete(db.aiosEvents).where(db.eq(db.aiosEvents.tenant_id, TEST_TENANT_ID))
    await drizzle.delete(db.budgets).where(
      db.and(db.eq(db.budgets.agent_id, TEST_AGENT_ID), db.eq(db.budgets.month, month))
    )
  })

  it('retorna BUDGET_EXCEEDED quando budget está esgotado', async () => {
    const drizzle = db.getDb()
    const month = new Date().toISOString().slice(0, 7)

    await drizzle.delete(db.budgets).where(
      db.and(db.eq(db.budgets.agent_id, TEST_AGENT_ID), db.eq(db.budgets.month, month))
    )
    await drizzle.insert(db.budgets).values({
      agent_id: TEST_AGENT_ID,
      tenant_id: TEST_TENANT_ID,
      month,
      spent_usd: '1.00',
      tokens_used: 0,
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/aios/execute',
      headers: { Authorization: `Bearer ${token}` },
      payload: { agent_id: TEST_AGENT_ID, skill_id: 'wiki:lint', input: {} },
    })

    expect(response.statusCode).toBe(402)
    const body = response.json<{ code: string }>()
    expect(body.code).toBe('BUDGET_EXCEEDED')
  })
})
