import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockLimit = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect }),
  aiosEvents: {},
  agents: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
}))

const { explainEventTool } = await import('../lib/copilot/tools/explain-event')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:explain_event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: mockLimit }),
        }),
        where: vi.fn().mockReturnValue({ limit: mockLimit }),
      }),
    })
  })

  it('returns event details + children', async () => {
    mockLimit
      .mockResolvedValueOnce([{
        id: 'e1', agent_id: 'a1', agent_name: 'Atendimento',
        skill_id: 'wiki:query', status: 'ok',
        payload: { question: 'olá' }, result: { answer: 'oi' },
        error_code: null, started_at: new Date(), completed_at: new Date(),
        tokens_used: 100, cost_usd: '0.001',
        call_depth: 0, parent_event_id: null,
      }])
      .mockResolvedValueOnce([])  // children

    const result = await explainEventTool.handler({ event_id: 'e1' }, ctx)
    expect(result.id).toBe('e1')
    expect(result.payload).toEqual({ question: 'olá' })
    expect(result.children).toEqual([])
  })

  it('throws when event not found', async () => {
    mockLimit.mockResolvedValueOnce([])
    await expect(explainEventTool.handler({ event_id: 'nope' }, ctx))
      .rejects.toThrow('Event not found')
  })

  it('has all_members permission', () => {
    expect(explainEventTool.permission).toBe('all_members')
  })
})
