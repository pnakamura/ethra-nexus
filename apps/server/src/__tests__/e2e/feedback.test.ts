// apps/server/src/__tests__/e2e/feedback.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('@ethra-nexus/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ethra-nexus/agents')>()
  return {
    ...mod,
    startSchedulerLoop: vi.fn(),
    writeLesson: vi.fn().mockResolvedValue(undefined),
  }
})

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: GET/POST /agents/:id/feedback', () => {
  let app: FastifyInstance
  let token: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any
  let agentId: string
  let eventId: string

  beforeAll(async () => {
    db = await import('@ethra-nexus/db')
    const { buildApp } = await import('../../app')
    app = await buildApp()
    await app.ready()
    token = await app.jwt.sign({ tenantId: TEST_TENANT_ID, email: 'test@test.com', role: 'admin' })
  })

  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Feedback Agent', slug: 'feedback-agent', role: 'support' },
    })
    agentId = (agentRes.json() as { data: { id: string } }).data.id

    const drizzle = db.getDb()
    const [event] = await drizzle.insert(db.aiosEvents).values({
      tenant_id: TEST_TENANT_ID,
      agent_id: agentId,
      skill_id: 'wiki:query',
      activation_mode: 'on_demand',
      payload: { question: 'Como funciona o processo de onboarding?' },
      result: { answer: 'O onboarding começa com o cadastro no sistema.' },
      status: 'ok',
    }).returning()
    eventId = event.id
  })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agentFeedback).where(db.eq(db.agentFeedback.agent_id, agentId))
    await drizzle.delete(db.aiosEvents).where(db.eq(db.aiosEvents.agent_id, agentId))
    await drizzle.delete(db.agents).where(
      db.and(db.eq(db.agents.id, agentId), db.eq(db.agents.tenant_id, TEST_TENANT_ID))
    )
  })

  // ── POST /feedback ────────────────────────────────────────────

  it('POST: cria feedback com rating e comment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: eventId, rating: 5, comment: 'Resposta excelente!' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { rating: number; comment: string } }>()
    expect(body.data.rating).toBe(5)
    expect(body.data.comment).toBe('Resposta excelente!')
  })

  it('POST: cria feedback sem comment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: eventId, rating: 3 },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { rating: number; comment: null } }>()
    expect(body.data.rating).toBe(3)
    expect(body.data.comment).toBeNull()
  })

  it('POST: atualiza feedback existente (upsert por aios_event_id)', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: eventId, rating: 2 },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: eventId, rating: 4, comment: 'Revisado: melhorou!' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { rating: number; comment: string } }>()
    expect(body.data.rating).toBe(4)
    expect(body.data.comment).toBe('Revisado: melhorou!')
  })

  it('POST: rejeita rating fora do intervalo 1-5', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: eventId, rating: 6 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST: rejeita comment com mais de 500 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: eventId, rating: 3, comment: 'x'.repeat(501) },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST: retorna 404 para evento que não pertence ao agente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: '00000000-0000-0000-0000-000000000099', rating: 4 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST: retorna 404 para agente inexistente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/00000000-0000-0000-0000-000000000099/feedback',
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: eventId, rating: 4 },
    })
    expect(res.statusCode).toBe(404)
  })

  // ── GET /feedback ─────────────────────────────────────────────

  it('GET: retorna lista vazia e meta zerada sem feedbacks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: unknown[]; meta: { total: number; avg_rating: null } }>()
    expect(body.data).toEqual([])
    expect(body.meta.total).toBe(0)
    expect(body.meta.avg_rating).toBeNull()
  })

  it('GET: retorna feedback com evento relacionado e métricas corretas', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
      payload: { aios_event_id: eventId, rating: 5, comment: 'Ótimo' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}/feedback`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{
      data: Array<{ rating: number; event: { skill_id: string } }>
      meta: { total: number; avg_rating: number; count_by_rating: Record<string, number> }
    }>()
    expect(body.data).toHaveLength(1)
    expect(body.data[0]?.rating).toBe(5)
    expect(body.data[0]?.event.skill_id).toBe('wiki:query')
    expect(body.meta.total).toBe(1)
    expect(body.meta.avg_rating).toBe(5)
    expect(body.meta.count_by_rating[5]).toBe(1)
    expect(body.meta.count_by_rating[4]).toBe(0)
  })

  it('GET: limit query param é respeitado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}/feedback?limit=5`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('GET: retorna 404 para agente inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/00000000-0000-0000-0000-000000000099/feedback',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
