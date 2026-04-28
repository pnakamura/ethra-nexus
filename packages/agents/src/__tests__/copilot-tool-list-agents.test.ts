import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({
    select: mockSelect,
  }),
  agents: {},
  agentSkills: {},
  agentChannels: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...conds) => ({ conds })),
}))

const { listAgentsTool } = await import('../lib/copilot/tools/list-agents')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:list_agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
  })

  it('lists agents filtered by tenant_id', async () => {
    mockWhere
      .mockResolvedValueOnce([
        { id: 'a1', slug: 'atendimento', name: 'Atendimento', role: 'support', status: 'active', model: 'sonnet', budget_monthly: '5.00' },
      ])
      .mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
      .mockResolvedValueOnce([{ id: 'c1' }])

    const result = await listAgentsTool.handler({}, ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'a1', slug: 'atendimento', name: 'Atendimento',
      skills_count: 2, channels_count: 1, budget_monthly: 5,
    })
  })

  it('passes status filter to query when provided', async () => {
    const { eq, and } = await import('drizzle-orm')
    mockWhere.mockResolvedValueOnce([])
    await listAgentsTool.handler({ status: 'paused' }, ctx)
    expect(eq).toHaveBeenCalled()
    expect(and).toHaveBeenCalled()
  })

  it('returns empty array when no agents in tenant', async () => {
    mockWhere.mockResolvedValueOnce([])
    const result = await listAgentsTool.handler({}, ctx)
    expect(result).toEqual([])
  })

  it('has all_members permission', () => {
    expect(listAgentsTool.permission).toBe('all_members')
  })
})
