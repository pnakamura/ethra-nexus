// apps/server/src/__tests__/e2e/budget.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
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

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: GET/PATCH /agents/:id/budget', () => {
  let app: FastifyInstance
  let token: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any
  let agentId: string

  beforeAll(async () => {
    db = await import('@ethra-nexus/db')
    const { buildApp } = await import('../../app')
    app = await buildApp()
    await app.ready()
    token = await app.jwt.sign({ tenantId: TEST_TENANT_ID, email: 'test@test.com', role: 'admin' })
  })

  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Budget Test', slug: 'budget-test', role: 'support', budget_monthly: '10.00' },
    })
    agentId = (res.json() as { data: { id: string } }).data.id
  })

  afterEach(async () => {
    const drizzle = db.getDb()
    const month = new Date().toISOString().slice(0, 7)
    await drizzle.delete(db.budgets).where(db.eq(db.budgets.agent_id, agentId))
    await drizzle.delete(db.agents).where(
      db.and(db.eq(db.agents.id, agentId), db.eq(db.agents.tenant_id, TEST_TENANT_ID))
    )
  })

  it('GET /budget retorna zeros quando não há gasto no mês', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { limit_usd: number; spent_usd: number; tokens_used: number; percent_used: number; throttled_at: null; alerts_fired: number[] } }>()
    expect(body.data.limit_usd).toBe(10)
    expect(body.data.spent_usd).toBe(0)
    expect(body.data.tokens_used).toBe(0)
    expect(body.data.percent_used).toBe(0)
    expect(body.data.throttled_at).toBeNull()
    expect(body.data.alerts_fired).toEqual([])
  })

  it('GET /budget reflete gasto registrado', async () => {
    const drizzle = db.getDb()
    const month = new Date().toISOString().slice(0, 7)
    await drizzle.insert(db.budgets).values({
      agent_id: agentId,
      tenant_id: TEST_TENANT_ID,
      month,
      spent_usd: '5.00',
      tokens_used: 10000,
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { spent_usd: number; tokens_used: number; percent_used: number } }>()
    expect(body.data.spent_usd).toBe(5)
    expect(body.data.tokens_used).toBe(10000)
    expect(body.data.percent_used).toBe(50)
  })

  it('GET /budget retorna 404 para agente inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/00000000-0000-0000-0000-000000000099/budget',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /budget atualiza limite e retorna status atualizado', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${token}` },
      payload: { monthly_limit_usd: 25 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { limit_usd: number; spent_usd: number } }>()
    expect(body.data.limit_usd).toBe(25)
    expect(body.data.spent_usd).toBe(0)
  })

  it('PATCH /budget aceita zero (sem limite)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${token}` },
      payload: { monthly_limit_usd: 0 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { limit_usd: number; percent_used: number } }>()
    expect(body.data.limit_usd).toBe(0)
    expect(body.data.percent_used).toBe(0)
  })

  it('PATCH /budget rejeita valor negativo', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${token}` },
      payload: { monthly_limit_usd: -5 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH /budget rejeita payload sem monthly_limit_usd', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/budget`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH /budget retorna 404 para agente inexistente', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agents/00000000-0000-0000-0000-000000000099/budget',
      headers: { authorization: `Bearer ${token}` },
      payload: { monthly_limit_usd: 20 },
    })
    expect(res.statusCode).toBe(404)
  })
})
