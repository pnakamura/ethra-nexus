import { describe, it, expect, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const mockDb = {
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  copilotConversations: { id: 'id', tenant_id: 'tid', user_id: 'uid', agent_id: 'aid', title: 'title', status: 'status', last_message_at: 'lma', updated_at: 'ua' },
  copilotMessages: { conversation_id: 'cid', tenant_id: 'tid', created_at: 'ca' },
  agents: { id: 'id', tenant_id: 'tid', slug: 'slug', system_prompt: 'sp' },
}))

vi.mock('@ethra-nexus/agents', () => ({
  executeCopilotTurn: vi.fn().mockResolvedValue({ total_tokens: 0, total_cost_usd: 0, tool_call_count: 0, stop_reason: 'end_turn' }),
  generateAutoTitle: vi.fn().mockResolvedValue(undefined),
  AIOS_MASTER_SYSTEM_PROMPT: 'mock system prompt',
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  desc: vi.fn((c) => ({ desc: c })),
  asc: vi.fn((c) => ({ asc: c })),
}))

const { copilotRoutes } = await import('../routes/copilot')

async function buildApp(userEmail: string, tenantId: string, role: 'admin' | 'member' = 'admin'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    request.tenantId = tenantId
    ;(request as { user?: { tenantId: string; email: string; role: string } }).user = {
      tenantId, email: userEmail, role,
    }
  })
  await app.register(copilotRoutes, { prefix: '/api/v1' })
  return app
}

describe('POST /api/v1/copilot/conversations', () => {
  it('creates conversation with the tenant aios-master agent', async () => {
    const app = await buildApp('user-1@x.com', 'tenant-1')
    // First (and only) select returns the aios-master agent. No member lookup (admin-only middleware).
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'agent-uuid' }]),
        }),
      }),
    })
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'conv-1', title: null, status: 'active' }]),
      }),
    })
    const res = await app.inject({ method: 'POST', url: '/api/v1/copilot/conversations', payload: {} })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).data.id).toBe('conv-1')
    await app.close()
  })

  it('returns 404 when aios-master agent missing for tenant', async () => {
    const app = await buildApp('user-1@x.com', 'tenant-1')
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),  // no aios-master row
        }),
      }),
    })
    const res = await app.inject({ method: 'POST', url: '/api/v1/copilot/conversations', payload: {} })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns 403 for non-admin user', async () => {
    const app = await buildApp('member@x.com', 'tenant-1', 'member')
    const res = await app.inject({ method: 'POST', url: '/api/v1/copilot/conversations', payload: {} })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('GET /api/v1/copilot/conversations', () => {
  it('lists user conversations sorted by last_message_at desc', async () => {
    const app = await buildApp('user-1@x.com', 'tenant-1')
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: 'c1', title: 'T1', status: 'active', message_count: 3, total_cost_usd: '0.01', last_message_at: new Date(), created_at: new Date() },
            ]),
          }),
        }),
      }),
    })
    const res = await app.inject({ method: 'GET', url: '/api/v1/copilot/conversations' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).data).toHaveLength(1)
    await app.close()
  })
})

describe('POST /api/v1/copilot/conversations/:id/messages', () => {
  it('returns 400 on empty content', async () => {
    const app = await buildApp('user-1@x.com', 'tenant-1')
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/c1/messages',
      payload: { content: '' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 413 on content > 50000 chars', async () => {
    const app = await buildApp('user-1@x.com', 'tenant-1')
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/c1/messages',
      payload: { content: 'x'.repeat(50001) },
    })
    expect(res.statusCode).toBe(413)
    await app.close()
  })

  it('returns 409 when conversation archived', async () => {
    const app = await buildApp('user-1@x.com', 'tenant-1')
    // Single DB call now: the conversation lookup (no member lookup since middleware is admin-only)
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            { id: 'c1', status: 'archived', user_id: 'user-1@x.com', tenant_id: 'tenant-1', agent_id: 'aios' },
          ]),
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/c1/messages',
      payload: { content: 'olá' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('returns 404 when conversation not found', async () => {
    const app = await buildApp('user-1@x.com', 'tenant-1')
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),  // no row
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/c1/messages',
      payload: { content: 'olá' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
