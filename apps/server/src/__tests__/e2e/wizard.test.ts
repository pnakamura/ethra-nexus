// apps/server/src/__tests__/e2e/wizard.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const mockQuestions = [
  { index: 0, text: 'Qual o domínio principal do agente?' },
  { index: 1, text: 'Quais são os processos mais comuns?' },
  { index: 2, text: 'Descreva os casos de uso frequentes.' },
  { index: 3, text: 'Quais são os termos específicos do setor?' },
  { index: 4, text: 'Quais são as regras de escalação?' },
  { index: 5, text: 'Quem são os responsáveis pelos processos?' },
]

vi.mock('@ethra-nexus/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ethra-nexus/agents')>()
  return {
    ...mod,
    startSchedulerLoop: vi.fn(),
    writeLesson: vi.fn().mockResolvedValue(undefined),
    createRegistryFromEnv: vi.fn(() => ({
      complete: vi.fn().mockResolvedValue({
        content: JSON.stringify(mockQuestions),
        input_tokens: 100,
        output_tokens: 200,
        estimated_cost_usd: 0.001,
        provider: 'openrouter',
        model: 'groq/llama',
        is_fallback: false,
      }),
    })),
    executeTask: vi.fn().mockResolvedValue({
      ok: true,
      data: { answer: 'Ingestão concluída: 4 páginas extraídas, 3 páginas persistidas.' },
      agent_id: 'test',
      skill_id: 'wiki:ingest',
      timestamp: new Date().toISOString(),
      tokens_used: 0,
      cost_usd: 0,
    }),
  }
})

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Clone Wizard sessions', () => {
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
    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Wizard Agent',
        slug: 'wizard-agent',
        role: 'support',
        description: 'Agente de suporte ao cliente',
      },
    })
    agentId = (agentRes.json() as { data: { id: string } }).data.id
  })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.cloneWizardSessions).where(db.eq(db.cloneWizardSessions.agent_id, agentId))
    await drizzle.delete(db.agents).where(
      db.and(db.eq(db.agents.id, agentId), db.eq(db.agents.tenant_id, TEST_TENANT_ID))
    )
  })

  // ── POST /sessions — iniciar ──────────────────────────────

  it('POST /sessions cria sessão com 6 perguntas geradas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { id: string; status: string; questions: unknown[] } }>()
    expect(body.data.status).toBe('active')
    expect(body.data.questions).toHaveLength(6)
    expect(body.data.id).toBeTruthy()
  })

  it('POST /sessions retorna 404 para agente inexistente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/00000000-0000-0000-0000-000000000099/wizard/sessions',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  // ── GET /sessions/:id — consultar ─────────────────────────

  it('GET /sessions/:id retorna sessão existente', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions`,
      headers: { authorization: `Bearer ${token}` },
    })
    const sessionId = (createRes.json() as { data: { id: string } }).data.id

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { id: string; answers: unknown[] } }>()
    expect(body.data.id).toBe(sessionId)
    expect(body.data.answers).toEqual([])
  })

  it('GET /sessions/:id retorna 404 para sessão inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}/wizard/sessions/00000000-0000-0000-0000-000000000099`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  // ── PATCH /sessions/:id — responder ───────────────────────

  it('PATCH /sessions/:id salva respostas parciais', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions`,
      headers: { authorization: `Bearer ${token}` },
    })
    const sessionId = (createRes.json() as { data: { id: string } }).data.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        answers: [
          { question_index: 0, answer: 'Suporte técnico de software' },
          { question_index: 1, answer: 'Abertura de chamados, diagnóstico e resolução' },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { answers: Array<{ question_index: number; answer: string }> } }>()
    expect(body.data.answers).toHaveLength(2)
    expect(body.data.answers[0]?.question_index).toBe(0)
  })

  it('PATCH /sessions/:id faz merge (não substitui respostas anteriores)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions`,
      headers: { authorization: `Bearer ${token}` },
    })
    const sessionId = (createRes.json() as { data: { id: string } }).data.id

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { answers: [{ question_index: 0, answer: 'Primeira resposta' }] },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { answers: [{ question_index: 1, answer: 'Segunda resposta' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { answers: unknown[] } }>()
    expect(body.data.answers).toHaveLength(2)
  })

  it('PATCH /sessions/:id rejeita resposta com mais de 5000 chars', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions`,
      headers: { authorization: `Bearer ${token}` },
    })
    const sessionId = (createRes.json() as { data: { id: string } }).data.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { answers: [{ question_index: 0, answer: 'x'.repeat(5001) }] },
    })
    expect(res.statusCode).toBe(400)
  })

  // ── POST /sessions/:id/finish — finalizar ─────────────────

  it('POST /finish completa sessão e retorna pages_created', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions`,
      headers: { authorization: `Bearer ${token}` },
    })
    const sessionId = (createRes.json() as { data: { id: string } }).data.id

    // Responder pelo menos metade das perguntas (3 de 6)
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        answers: [
          { question_index: 0, answer: 'Suporte de TI para empresas de médio porte' },
          { question_index: 1, answer: 'Abertura de chamados, triagem e escalonamento' },
          { question_index: 2, answer: 'Problemas de acesso, instalação de software, VPN' },
        ],
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}/finish`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { session_id: string; pages_created: number; summary: string } }>()
    expect(body.data.session_id).toBe(sessionId)
    expect(body.data.pages_created).toBeGreaterThanOrEqual(0)
    expect(body.data.summary).toBeTruthy()
  })

  it('POST /finish retorna 409 para sessão já completada', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions`,
      headers: { authorization: `Bearer ${token}` },
    })
    const sessionId = (createRes.json() as { data: { id: string } }).data.id

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        answers: [
          { question_index: 0, answer: 'Resposta A' },
          { question_index: 1, answer: 'Resposta B' },
          { question_index: 2, answer: 'Resposta C' },
        ],
      },
    })
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}/finish`,
      headers: { authorization: `Bearer ${token}` },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}/finish`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(409)
  })

  it('POST /finish retorna 422 quando menos de metade das perguntas respondidas', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions`,
      headers: { authorization: `Bearer ${token}` },
    })
    const sessionId = (createRes.json() as { data: { id: string } }).data.id

    // Só 2 respostas de 6 (< 3 necessárias)
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        answers: [
          { question_index: 0, answer: 'Apenas uma resposta' },
          { question_index: 1, answer: 'Apenas duas' },
        ],
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/wizard/sessions/${sessionId}/finish`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(422)
  })
})
