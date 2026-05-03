import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const mockDb = {
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

const executeCopilotTurnMock = vi.fn().mockResolvedValue({
  total_tokens: 0, total_cost_usd: 0, tool_call_count: 0, stop_reason: 'end_turn',
})

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  copilotConversations: { id: 'id', tenant_id: 'tid', user_id: 'uid', agent_id: 'aid', title: 'title', status: 'status', last_message_at: 'lma', updated_at: 'ua' },
  copilotMessages: { conversation_id: 'cid', tenant_id: 'tid', created_at: 'ca' },
  agents: { id: 'id', tenant_id: 'tid', slug: 'slug', system_prompt: 'sp' },
  systemAlerts: { id: 'id', tenant_id: 'tid', category: 'cat', code: 'code', severity: 'sev', message: 'msg', fired_at: 'fat', resolved_at: 'rat' },
}))

vi.mock('@ethra-nexus/agents', () => ({
  executeCopilotTurn: executeCopilotTurnMock,
  generateAutoTitle: vi.fn().mockResolvedValue(undefined),
  AIOS_MASTER_SYSTEM_PROMPT: 'mock system prompt',
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  desc: vi.fn((c) => ({ desc: c })),
  asc: vi.fn((c) => ({ asc: c })),
  isNull: vi.fn((c) => ({ isnull: c })),
}))

const { copilotRoutes } = await import('../routes/copilot')

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook('onRequest', async (request) => {
    request.tenantId = 't1'
    ;(request as { user?: { tenantId: string; slug: string; role: string } }).user = {
      tenantId: 't1', slug: 'u1', role: 'admin',
    }
  })
  await app.register(copilotRoutes, { prefix: '/api/v1' })
  return app
}

beforeEach(() => {
  executeCopilotTurnMock.mockReset()
  executeCopilotTurnMock.mockResolvedValue({
    total_tokens: 0, total_cost_usd: 0, tool_call_count: 0, stop_reason: 'end_turn',
  })
})

describe('POST /api/v1/copilot/conversations/:id/messages — attachments validation', () => {
  it('rejects attachments[] of length 4 with 400 TOO_MANY_ATTACHMENTS', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/00000000-0000-0000-0000-000000000000/messages',
      payload: {
        content: 'hi',
        attachments: [
          { file_id: '11111111-1111-1111-1111-111111111111', filename: 'a.xlsx' },
          { file_id: '22222222-2222-2222-2222-222222222222', filename: 'b.xlsx' },
          { file_id: '33333333-3333-3333-3333-333333333333', filename: 'c.xlsx' },
          { file_id: '44444444-4444-4444-4444-444444444444', filename: 'd.xlsx' },
        ],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'TOO_MANY_ATTACHMENTS' })
    await app.close()
  })

  it('rejects malformed file_id with 400 INVALID_ATTACHMENT', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/00000000-0000-0000-0000-000000000000/messages',
      payload: {
        content: 'hi',
        attachments: [{ file_id: 'not-a-uuid', filename: 'a.xlsx' }],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'INVALID_ATTACHMENT' })
    await app.close()
  })

  it('rejects empty filename with 400 INVALID_ATTACHMENT', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/00000000-0000-0000-0000-000000000000/messages',
      payload: {
        content: 'hi',
        attachments: [{ file_id: '11111111-1111-1111-1111-111111111111', filename: '' }],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: 'INVALID_ATTACHMENT' })
    await app.close()
  })

  it('passes validation with 1 valid attachment (downstream may 404 conversation, OK)', async () => {
    const app = await buildApp()
    // DB returns no conversation (404) — that's fine, we only care that
    // attachment validation does NOT reject with 400.
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/copilot/conversations/00000000-0000-0000-0000-000000000000/messages',
      payload: {
        content: 'qual aba tem mais linhas?',
        attachments: [{ file_id: '11111111-1111-1111-1111-111111111111', filename: 'vendas.xlsx' }],
      },
    })
    // Validation passed — no TOO_MANY_ATTACHMENTS or INVALID_ATTACHMENT 400.
    // Conversation lookup returns empty → 404, which is acceptable.
    expect(res.statusCode).not.toBe(400)
    await app.close()
  })
})
