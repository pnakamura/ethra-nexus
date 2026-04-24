import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildApp } from '../../app'
import type { FastifyInstance } from 'fastify'

// Skip all if no test DB available
const skip = !process.env['DATABASE_URL_TEST']

describe.skipIf(skip)('A2A Protocol — E2E', () => {
  let app: FastifyInstance
  let tenantId: string
  let agentId: string
  let jwtToken: string

  beforeAll(async () => {
    vi.mock('@ethra-nexus/core', async (importOriginal) => {
      const orig = await importOriginal<typeof import('@ethra-nexus/core')>()
      return {
        ...orig,
        validateExternalUrl: vi.fn().mockResolvedValue(undefined),
      }
    })

    app = await buildApp()
    await app.ready()

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { slug: 'test-a2a', password: 'test123', name: 'A2A Test Tenant' },
    })
    const { token, tenant } = loginRes.json<{ token: string; tenant: { id: string } }>()
    jwtToken = token
    tenantId = tenant.id

    const agentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${jwtToken}` },
      payload: {
        name: 'Ambassador Agent',
        slug: 'ambassador',
        role: 'A2A public agent',
        skills: [{ skill_name: 'channel:respond' }],
      },
    })
    agentId = agentRes.json<{ data: { id: string } }>().data.id
  })

  afterAll(async () => {
    await app.close()
  })

  describe('PATCH /agents/:id — a2a_enabled', () => {
    it('enables a2a on an agent', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/agents/${agentId}`,
        headers: { authorization: `Bearer ${jwtToken}` },
        payload: { a2a_enabled: true },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.a2a_enabled).toBe(true)
    })

    it('rejects enabling a2a when another agent already has it', async () => {
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: { authorization: `Bearer ${jwtToken}` },
        payload: { name: 'Second Agent', slug: 'second-agent', role: 'test' },
      })
      const secondId = res2.json<{ data: { id: string } }>().data.id

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/agents/${secondId}`,
        headers: { authorization: `Bearer ${jwtToken}` },
        payload: { a2a_enabled: true },
      })
      expect(res.statusCode).toBe(409)
    })
  })

  describe('GET /.well-known/agent.json', () => {
    it('returns Agent Card for a2a_enabled agent', async () => {
      const res = await app.inject({ method: 'GET', url: '/.well-known/agent.json' })
      expect(res.statusCode).toBe(200)
      const card = res.json()
      expect(card.name).toBe('Ambassador Agent')
      expect(card.version).toBe('1.0.0')
      expect(Array.isArray(card.skills)).toBe(true)
    })

    it('returns 404 when no agent has a2a_enabled', async () => {
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/agents/${agentId}`,
        headers: { authorization: `Bearer ${jwtToken}` },
        payload: { a2a_enabled: false },
      })
      const res = await app.inject({ method: 'GET', url: '/.well-known/agent.json' })
      expect(res.statusCode).toBe(404)
      // Re-enable
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/agents/${agentId}`,
        headers: { authorization: `Bearer ${jwtToken}` },
        payload: { a2a_enabled: true },
      })
    })
  })

  describe('API Keys', () => {
    let apiKey: string
    let keyId: string

    it('POST /api/v1/a2a/keys — creates key with enx_ prefix', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/a2a/keys',
        headers: { authorization: `Bearer ${jwtToken}` },
        payload: { name: 'Test Key', agent_id: agentId },
      })
      expect(res.statusCode).toBe(201)
      const { data } = res.json<{ data: { key: string; prefix: string; id?: string } }>()
      expect(data.key).toMatch(/^enx_/)
      apiKey = data.key
    })

    it('GET /api/v1/a2a/keys — lists keys without key_hash', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/a2a/keys',
        headers: { authorization: `Bearer ${jwtToken}` },
      })
      expect(res.statusCode).toBe(200)
      const keys = res.json<{ data: Array<{ key_prefix: string; name: string; id: string }> }>().data
      expect(keys.length).toBeGreaterThan(0)
      expect(keys[0]).not.toHaveProperty('key_hash')
      keyId = keys[0]!.id
    })

    describe('POST /api/v1/a2a — JSON-RPC', () => {
      it('returns 401 without Authorization header', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/a2a',
          payload: {
            jsonrpc: '2.0',
            id: 1,
            method: 'tasks/send',
            params: { message: { parts: [{ text: 'Hi' }] } },
          },
        })
        expect(res.statusCode).toBe(401)
      })

      it('tasks/send returns state: submitted', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/a2a',
          headers: { authorization: `Bearer ${apiKey}` },
          payload: {
            jsonrpc: '2.0',
            id: 'req-1',
            method: 'tasks/send',
            params: { message: { role: 'user', parts: [{ text: 'Hello' }] } },
          },
        })
        expect(res.statusCode).toBe(200)
        const body = res.json()
        expect(body.result.status.state).toBe('submitted')
        expect(body.result.id).toBeDefined()
      })

      it('unknown method returns error code -32601', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/a2a',
          headers: { authorization: `Bearer ${apiKey}` },
          payload: { jsonrpc: '2.0', id: 1, method: 'tasks/unknown' },
        })
        expect(res.statusCode).toBe(200)
        expect(res.json().error.code).toBe(-32601)
      })
    })

    it('DELETE /api/v1/a2a/keys/:id — revokes key, subsequent call returns 401', async () => {
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/a2a/keys/${keyId}`,
        headers: { authorization: `Bearer ${jwtToken}` },
      })
      expect(deleteRes.statusCode).toBe(204)

      const a2aRes = await app.inject({
        method: 'POST',
        url: '/api/v1/a2a',
        headers: { authorization: `Bearer ${apiKey}` },
        payload: { jsonrpc: '2.0', id: 1, method: 'tasks/send' },
      })
      expect(a2aRes.statusCode).toBe(401)
    })
  })

  describe('External Agent Registry', () => {
    it('POST /api/v1/a2a/agents with http:// URL returns 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/a2a/agents',
        headers: { authorization: `Bearer ${jwtToken}` },
        payload: { url: 'http://example.com/a2a' },
      })
      // validateExternalUrl mock resolves; http:// still fails on HTTPS check in real validate
      // Since mock bypasses validate, this hits the Agent Card fetch — which fails → 400
      expect(res.statusCode).toBe(400)
    })

    it('GET /api/v1/a2a/agents — returns list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/a2a/agents',
        headers: { authorization: `Bearer ${jwtToken}` },
      })
      expect(res.statusCode).toBe(200)
      expect(Array.isArray(res.json().data)).toBe(true)
    })

    it('DELETE /api/v1/a2a/agents/:id of nonexistent returns 404', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/a2a/agents/00000000-0000-0000-0000-000000000000',
        headers: { authorization: `Bearer ${jwtToken}` },
      })
      expect(res.statusCode).toBe(404)
    })
  })
})
