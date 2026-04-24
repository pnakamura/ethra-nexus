// apps/server/src/__tests__/e2e/agents.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

vi.mock('@ethra-nexus/agents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ethra-nexus/agents')>()
  return { ...mod, startSchedulerLoop: vi.fn() }
})

// ── Testes puros de validação (sem banco) ────────────────────

import {
  isValidSkillId,
  isValidChannelType,
  isValidTone,
  validateChannelConfig,
} from '../../routes/agents.types'

describe('isValidSkillId', () => {
  it('aceita skill_ids built-in', () => {
    expect(isValidSkillId('wiki:query')).toBe(true)
    expect(isValidSkillId('channel:respond')).toBe(true)
    expect(isValidSkillId('monitor:alert')).toBe(true)
    expect(isValidSkillId('data:extract')).toBe(true)
  })

  it('aceita custom skill_ids no padrão custom:{slug}', () => {
    expect(isValidSkillId('custom:meu-workflow')).toBe(true)
    expect(isValidSkillId('custom:processo-123')).toBe(true)
  })

  it('rejeita skill_ids inválidos', () => {
    expect(isValidSkillId('invalid')).toBe(false)
    expect(isValidSkillId('custom:')).toBe(false)
    expect(isValidSkillId('custom:ABC')).toBe(false)
    expect(isValidSkillId('')).toBe(false)
  })
})

describe('isValidChannelType', () => {
  it('aceita tipos válidos', () => {
    expect(isValidChannelType('whatsapp')).toBe(true)
    expect(isValidChannelType('webchat')).toBe(true)
    expect(isValidChannelType('email')).toBe(true)
  })

  it('rejeita tipos inválidos', () => {
    expect(isValidChannelType('telegram')).toBe(false)
    expect(isValidChannelType('')).toBe(false)
  })
})

describe('isValidTone', () => {
  it('aceita tons válidos', () => {
    expect(isValidTone('formal')).toBe(true)
    expect(isValidTone('professional')).toBe(true)
    expect(isValidTone('custom')).toBe(true)
  })

  it('rejeita tons inválidos', () => {
    expect(isValidTone('casual')).toBe(false)
    expect(isValidTone('')).toBe(false)
  })
})

describe('validateChannelConfig', () => {
  it('whatsapp: retorna null quando evolution_instance presente', () => {
    expect(validateChannelConfig('whatsapp', { evolution_instance: 'nexus-wa' })).toBeNull()
  })

  it('whatsapp: retorna erro quando evolution_instance ausente', () => {
    expect(validateChannelConfig('whatsapp', {})).toContain('evolution_instance')
  })

  it('webhook: retorna erro quando endpoint_url não começa com https://', () => {
    expect(validateChannelConfig('webhook', { endpoint_url: 'http://insecure.com' })).toContain('https://')
  })

  it('webhook: retorna null quando endpoint_url é https', () => {
    expect(validateChannelConfig('webhook', { endpoint_url: 'https://meusite.com/hook' })).toBeNull()
  })

  it('email: retorna erro quando address não contém @', () => {
    expect(validateChannelConfig('email', { address: 'invalido' })).toContain('@')
  })

  it('email: retorna null quando address é válido', () => {
    expect(validateChannelConfig('email', { address: 'user@example.com' })).toBeNull()
  })

  it('webchat: retorna null sem campos obrigatórios', () => {
    expect(validateChannelConfig('webchat', {})).toBeNull()
  })

  it('api: retorna null sem campos obrigatórios', () => {
    expect(validateChannelConfig('api', {})).toBeNull()
  })
})

// ── Testes de rota (E2E — requer DATABASE_URL_TEST) ──────────

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Agent CRUD endpoints', () => {
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
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
  })

  // ── POST /agents ─────────────────────────────────────────

  it('POST /agents cria com campos mínimos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Test Agent', slug: 'test-agent', role: 'support' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { id: string; slug: string; tone: string; skills: unknown[]; channels: unknown[] } }>()
    expect(body.data.slug).toBe('test-agent')
    expect(body.data.tone).toBe('professional')
    expect(body.data.skills).toEqual([])
    expect(body.data.channels).toEqual([])
  })

  it('POST /agents cria com identidade completa', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Full Agent',
        slug: 'full-agent',
        role: 'support',
        system_prompt: 'Você é um assistente.',
        tone: 'formal',
        response_language: 'pt-BR',
        restrictions: ['Nunca prometer prazos'],
        tags: ['suporte', 'vendas'],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { tone: string; restrictions: string[]; tags: string[] } }>()
    expect(body.data.tone).toBe('formal')
    expect(body.data.restrictions).toEqual(['Nunca prometer prazos'])
    expect(body.data.tags).toEqual(['suporte', 'vendas'])
  })

  it('POST /agents cria com skills', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Skilled Agent',
        slug: 'skilled-agent',
        role: 'support',
        skills: [
          { skill_id: 'wiki:query', enabled: true },
          { skill_id: 'channel:respond', enabled: true },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { skills: Array<{ skill_name: string }> } }>()
    expect(body.data.skills).toHaveLength(2)
    expect(body.data.skills.map((s) => s.skill_name)).toContain('wiki:query')
  })

  it('POST /agents cria com canal whatsapp', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'WA Agent',
        slug: 'wa-agent',
        role: 'support',
        channels: [
          { channel_type: 'whatsapp', config: { evolution_instance: 'nexus-wa' } },
        ],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { channels: Array<{ channel_type: string }> } }>()
    expect(body.data.channels).toHaveLength(1)
    expect(body.data.channels[0]?.channel_type).toBe('whatsapp')
  })

  it('POST /agents retorna 400 para slug inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Bad', slug: 'INVALID SLUG!', role: 'support' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /agents retorna 409 para slug duplicado no tenant', async () => {
    const payload = { name: 'Agent', slug: 'dup-agent', role: 'support' }
    await app.inject({ method: 'POST', url: '/api/v1/agents', headers: { authorization: `Bearer ${token}` }, payload })
    const res = await app.inject({ method: 'POST', url: '/api/v1/agents', headers: { authorization: `Bearer ${token}` }, payload })
    expect(res.statusCode).toBe(409)
  })

  it('POST /agents retorna 400 para skill_id inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'bad-skill-agent', role: 'support', skills: [{ skill_id: 'nao-existe' }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /agents retorna 400 para channel_type inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'bad-channel-agent', role: 'support', channels: [{ channel_type: 'telegram', config: {} }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /agents retorna 400 para config de canal incompleto', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'bad-config-agent', role: 'support', channels: [{ channel_type: 'whatsapp', config: {} }] },
    })
    expect(res.statusCode).toBe(400)
  })

  // ── PATCH /agents/:id ─────────────────────────────────────

  it('PATCH /agents/:id atualiza system_prompt', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'patch-agent', role: 'support' },
    })
    const agentId = created.json<{ data: { id: string } }>().data.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { system_prompt: 'Novo prompt' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ data: { system_prompt: string } }>().data.system_prompt).toBe('Novo prompt')
  })

  it('PATCH /agents/:id faz upsert de skill nova', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'upsert-skill-agent', role: 'support' },
    })
    const agentId = created.json<{ data: { id: string } }>().data.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skills: [{ skill_id: 'wiki:query', enabled: true }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { skills: Array<{ skill_name: string }> } }>()
    expect(body.data.skills.map((s) => s.skill_name)).toContain('wiki:query')
  })

  it('PATCH /agents/:id retorna 404 para agente de outro tenant', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agents/00000000-0000-0000-0099-000000000001',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Hack' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /agents/:id retorna 404 para agente arquivado', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'archived-patch-agent', role: 'support' },
    })
    const agentId = created.json<{ data: { id: string } }>().data.id

    await app.inject({ method: 'DELETE', url: `/api/v1/agents/${agentId}`, headers: { authorization: `Bearer ${token}` } })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Ghost' },
    })
    expect(res.statusCode).toBe(404)
  })

  // ── DELETE /agents/:id ────────────────────────────────────

  it('DELETE /agents/:id arquiva o agente', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'to-delete-agent', role: 'support' },
    })
    const agentId = created.json<{ data: { id: string } }>().data.id

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(del.statusCode).toBe(204)

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(get.statusCode).toBe(404)
  })

  it('DELETE /agents/:id retorna 404 para agente já arquivado', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'double-delete-agent', role: 'support' },
    })
    const agentId = created.json<{ data: { id: string } }>().data.id

    await app.inject({ method: 'DELETE', url: `/api/v1/agents/${agentId}`, headers: { authorization: `Bearer ${token}` } })
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/agents/${agentId}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /agents/:id retorna 404 para agente de outro tenant', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/agents/00000000-0000-0000-0099-000000000001',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  // ── GET /agents ───────────────────────────────────────────

  it('GET /agents não retorna agentes arquivados', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agent', slug: 'hidden-agent', role: 'support' },
    })
    const agentId = created.json<{ data: { id: string } }>().data.id
    await app.inject({ method: 'DELETE', url: `/api/v1/agents/${agentId}`, headers: { authorization: `Bearer ${token}` } })

    const list = await app.inject({ method: 'GET', url: '/api/v1/agents', headers: { authorization: `Bearer ${token}` } })
    const ids = list.json<{ data: Array<{ id: string }> }>().data.map((a) => a.id)
    expect(ids).not.toContain(agentId)
  })

  it('GET /agents retorna skills e channels embutidos', async () => {
    await app.inject({
      method: 'POST', url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Full', slug: 'full-embed-agent', role: 'support',
        skills: [{ skill_id: 'wiki:query' }],
        channels: [{ channel_type: 'webchat', config: {} }],
      },
    })
    const list = await app.inject({ method: 'GET', url: '/api/v1/agents', headers: { authorization: `Bearer ${token}` } })
    const agent = list.json<{ data: Array<{ skills: unknown[]; channels: unknown[] }> }>().data[0]
    expect(agent?.skills).toBeDefined()
    expect(agent?.channels).toBeDefined()
  })
})

// ── E2E: Skills individuais ──────────────────────────────────

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Skills endpoints', () => {
  let app: FastifyInstance
  let token: string
  let agentId: string
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

  beforeEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Skills Test Agent', slug: 'skills-test', role: 'support' },
    })
    agentId = res.json<{ data: { id: string } }>().data.id
  })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
  })

  it('POST /agents/:id/skills retorna 201 com skill criada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query', enabled: true },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { skill_name: string; enabled: boolean } }>()
    expect(body.data.skill_name).toBe('wiki:query')
    expect(body.data.enabled).toBe(true)
  })

  it('POST /agents/:id/skills retorna 400 para skill_id inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'invalid-skill' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /agents/:id/skills retorna 404 para agente de outro tenant', async () => {
    const otherToken = await app.jwt.sign({ tenantId: '00000000-0000-0000-0000-000000000099', email: 'x@x.com', role: 'admin' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { skill_id: 'wiki:query' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /agents/:id/skills retorna 404 para agente arquivado', async () => {
    await app.inject({ method: 'DELETE', url: `/api/v1/agents/${agentId}`, headers: { authorization: `Bearer ${token}` } })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /agents/:id/skills retorna 409 para skill já existente', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query' },
    })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('PATCH /agents/:id/skills/:skill_name atualiza enabled', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query', enabled: true },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { enabled: boolean } }>()
    expect(body.data.enabled).toBe(false)
  })

  it('PATCH /agents/:id/skills/:skill_name atualiza skill_config parcialmente', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query', max_tokens_per_call: 1000 },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { max_calls_per_hour: 50 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ data: { skill_config: Record<string, unknown> } }>()
    expect(body.data.skill_config['max_tokens_per_call']).toBe(1000)
    expect(body.data.skill_config['max_calls_per_hour']).toBe(50)
  })

  it('PATCH /agents/:id/skills/:skill_name retorna 404 para skill inexistente', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /agents/:id/skills/:skill_name remove skill (204)', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/skills`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skill_id: 'wiki:query' },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /agents/:id/skills/:skill_name retorna 404 para skill inexistente', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}/skills/wiki:query`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

// ── E2E: Canais individuais ──────────────────────────────────

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Channels endpoints', () => {
  let app: FastifyInstance
  let token: string
  let agentId: string
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

  beforeEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Channels Test Agent', slug: 'channels-test', role: 'support' },
    })
    agentId = res.json<{ data: { id: string } }>().data.id
  })

  afterEach(async () => {
    const drizzle = db.getDb()
    await drizzle.delete(db.agents).where(db.eq(db.agents.tenant_id, TEST_TENANT_ID))
  })

  it('POST /agents/:id/channels retorna 201 com canal criado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'whatsapp', config: { evolution_instance: 'nexus-wa' } },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ data: { channel_type: string; enabled: boolean } }>()
    expect(body.data.channel_type).toBe('whatsapp')
    expect(body.data.enabled).toBe(true)
  })

  it('POST /agents/:id/channels retorna 400 para channel_type inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'telegram', config: {} },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /agents/:id/channels retorna 400 para config incompleto (whatsapp sem evolution_instance)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'whatsapp', config: {} },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('evolution_instance')
  })

  it('POST /agents/:id/channels retorna 404 para agente de outro tenant', async () => {
    const otherToken = await app.jwt.sign({ tenantId: '00000000-0000-0000-0000-000000000099', email: 'x@x.com', role: 'admin' })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { channel_type: 'webchat', config: {} },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /agents/:id/channels retorna 404 para agente arquivado', async () => {
    await app.inject({ method: 'DELETE', url: `/api/v1/agents/${agentId}`, headers: { authorization: `Bearer ${token}` } })
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'webchat', config: {} },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /agents/:id/channels retorna 409 para canal já existente', async () => {
    const payload = { channel_type: 'webchat', config: {} }
    await app.inject({ method: 'POST', url: `/api/v1/agents/${agentId}/channels`, headers: { authorization: `Bearer ${token}` }, payload })
    const res = await app.inject({ method: 'POST', url: `/api/v1/agents/${agentId}/channels`, headers: { authorization: `Bearer ${token}` }, payload })
    expect(res.statusCode).toBe(409)
  })

  it('PATCH /agents/:id/channels/:channel_type atualiza enabled', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'webchat', config: {} },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/channels/webchat`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ data: { enabled: boolean } }>().data.enabled).toBe(false)
  })

  it('PATCH /agents/:id/channels/:channel_type atualiza config parcialmente', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'whatsapp', config: { evolution_instance: 'nexus-wa' } },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/channels/whatsapp`,
      headers: { authorization: `Bearer ${token}` },
      payload: { config: { webhook_url: 'https://meusite.com/hook' } },
    })
    expect(res.statusCode).toBe(200)
    const cfg = res.json<{ data: { config: Record<string, unknown> } }>().data.config
    // evolution_instance preservado, webhook_url adicionado
    expect(cfg['evolution_instance']).toBe('nexus-wa')
    expect(cfg['webhook_url']).toBe('https://meusite.com/hook')
  })

  it('PATCH /agents/:id/channels/:channel_type retorna 400 se config merged fica inválido', async () => {
    // Create whatsapp channel with required evolution_instance
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'whatsapp', config: { evolution_instance: 'nexus-wa' } },
    })
    // PATCH sends config that overwrites evolution_instance with empty string — merged config is invalid
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/channels/whatsapp`,
      headers: { authorization: `Bearer ${token}` },
      payload: { config: { evolution_instance: '' } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json<{ error: string }>().error).toContain('evolution_instance')
  })

  it('PATCH /agents/:id/channels/:channel_type retorna 404 para canal inexistente', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}/channels/webchat`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /agents/:id/channels/:channel_type remove canal (204)', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/channels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { channel_type: 'webchat', config: {} },
    })
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}/channels/webchat`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(204)
  })

  it('DELETE /agents/:id/channels/:channel_type retorna 404 para canal inexistente', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}/channels/webchat`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe.skipIf(!process.env['DATABASE_URL_TEST'])('E2E: Wiki config nos agentes', () => {
  let app: FastifyInstance
  let tenantId: string
  let agentId: string

  beforeAll(async () => {
    const { buildApp } = await import('../../app')
    app = await buildApp()

    const tenantRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      payload: { name: 'Wiki Test Tenant', slug: `wiki-tenant-${Date.now()}` },
    })
    tenantId = (JSON.parse(tenantRes.body) as { data: { id: string } }).data.id
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    const token = await app.jwt.sign({ tenantId })
    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Wiki Agent',
        slug: `wiki-agent-${Date.now()}`,
        role: 'assistente',
      },
    })
    agentId = (JSON.parse(agentRes.body) as { data: { id: string } }).data.id
  })

  afterEach(async () => {
    const token = await app.jwt.sign({ tenantId })
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
    })
  })

  async function patch(payload: Record<string, unknown>) {
    const token = await app.jwt.sign({ tenantId })
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    })
  }

  it('GET /agents/:id retorna campos wiki com defaults', async () => {
    const token = await app.jwt.sign({ tenantId })
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(agent['wiki_enabled']).toBe(true)
    expect(agent['wiki_top_k']).toBe(5)
    expect(Number(agent['wiki_min_score'])).toBeCloseTo(0.72)
    expect(agent['wiki_write_mode']).toBe('supervised')
  })

  it('PATCH wiki_enabled: false — desabilita wiki do agente', async () => {
    const res = await patch({ wiki_enabled: false })
    expect(res.statusCode).toBe(200)
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(agent['wiki_enabled']).toBe(false)
  })

  it('PATCH wiki_top_k: 10 — atualiza valor', async () => {
    const res = await patch({ wiki_top_k: 10 })
    expect(res.statusCode).toBe(200)
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(agent['wiki_top_k']).toBe(10)
  })

  it('PATCH wiki_top_k: 0 — retorna 400 (fora do range 1-20)', async () => {
    const res = await patch({ wiki_top_k: 0 })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH wiki_top_k: 21 — retorna 400 (fora do range 1-20)', async () => {
    const res = await patch({ wiki_top_k: 21 })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH wiki_min_score: 0.85 — atualiza valor', async () => {
    const res = await patch({ wiki_min_score: 0.85 })
    expect(res.statusCode).toBe(200)
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(Number(agent['wiki_min_score'])).toBeCloseTo(0.85)
  })

  it('PATCH wiki_min_score: -0.1 — retorna 400', async () => {
    const res = await patch({ wiki_min_score: -0.1 })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH wiki_min_score: 1.1 — retorna 400', async () => {
    const res = await patch({ wiki_min_score: 1.1 })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH wiki_write_mode: auto — atualiza valor', async () => {
    const res = await patch({ wiki_write_mode: 'auto' })
    expect(res.statusCode).toBe(200)
    const agent = (JSON.parse(res.body) as { data: Record<string, unknown> }).data
    expect(agent['wiki_write_mode']).toBe('auto')
  })

  it('PATCH wiki_write_mode: invalid — retorna 400', async () => {
    const res = await patch({ wiki_write_mode: 'invalid' })
    expect(res.statusCode).toBe(400)
  })
})
