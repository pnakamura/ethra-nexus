// apps/server/src/__tests__/e2e/tenant-isolation.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('@ethra-nexus/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ethra-nexus/agents')>()
  return { ...mod, startSchedulerLoop: vi.fn() }
})

const TENANT_A_ID = '00000000-0000-0000-0000-000000000001'
const TENANT_B_ID = '00000000-0000-0000-0000-000000000002'
const AGENT_A_ID  = '00000000-0000-0000-0001-000000000001'
const AGENT_B_ID  = '00000000-0000-0000-0002-000000000001'

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Multi-tenant isolation (RLS)', () => {
  let app: FastifyInstance
  let tokenA: string
  let tokenB: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any

  beforeAll(async () => {
    db = await import('@ethra-nexus/db')
    const { buildApp } = await import('../../app')
    app = await buildApp()
    await app.ready()
    tokenA = await app.jwt.sign({ tenantId: TENANT_A_ID, email: 'a@test.com', role: 'admin' })
    tokenB = await app.jwt.sign({ tenantId: TENANT_B_ID, email: 'b@test.com', role: 'admin' })
  })

  afterAll(async () => { await app.close() })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agentSchedules).where(db.eq(db.agentSchedules.tenant_id, TENANT_A_ID))
    await drizzle.delete(db.agentSchedules).where(db.eq(db.agentSchedules.tenant_id, TENANT_B_ID))
  })

  it('Tenant B não enxerga agente do Tenant A', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${AGENT_A_ID}`,
      headers: { Authorization: `Bearer ${tokenB}` },
    })

    expect(response.statusCode).toBe(404)
  })

  it('Tenant A não vê schedules do Tenant B', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/schedules',
      headers: { Authorization: `Bearer ${tokenB}` },
      payload: { agent_id: AGENT_B_ID, skill_id: 'wiki:lint', cron_expression: '*/5 * * * *' },
    })

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/schedules',
      headers: { Authorization: `Bearer ${tokenA}` },
    })

    expect(listRes.statusCode).toBe(200)
    const body = listRes.json<{ data: Array<{ tenant_id: string }> }>()
    const crossTenantSchedules = body.data.filter(s => s.tenant_id === TENANT_B_ID)
    expect(crossTenantSchedules).toHaveLength(0)
  })
})
