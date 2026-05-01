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
  desc: vi.fn((c) => ({ desc: c })),
  gte: vi.fn((c, v) => ({ c, v })),
}))

const { getRecentEventsTool } = await import('../lib/copilot/tools/get-recent-events')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:get_recent_events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLimit.mockResolvedValue([])
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({ limit: mockLimit }),
          }),
        }),
      }),
    })
  })

  it('returns events with agent_name joined', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'e1', agent_id: 'a1', agent_name: 'Atendimento',
      skill_id: 'wiki:query', status: 'ok',
      started_at: new Date('2026-04-27T10:00:00Z'),
      completed_at: new Date('2026-04-27T10:00:02Z'),
      tokens_used: 1200, cost_usd: '0.012345', error_code: null,
    }])
    const result = await getRecentEventsTool.handler({}, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'e1', agent_name: 'Atendimento', cost_usd: 0.012345,
      latency_ms: 2000,
    })
  })

  it('clamps limit to max 100', async () => {
    await getRecentEventsTool.handler({ limit: 999 }, ctx)
    expect(mockLimit).toHaveBeenCalledWith(100)
  })

  it('uses default limit of 20 when not provided', async () => {
    await getRecentEventsTool.handler({}, ctx)
    expect(mockLimit).toHaveBeenCalledWith(20)
  })

  it('has all_members permission', () => {
    expect(getRecentEventsTool.permission).toBe('all_members')
  })
})
