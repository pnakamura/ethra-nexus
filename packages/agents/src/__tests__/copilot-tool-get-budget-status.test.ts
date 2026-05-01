import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect }),
  budgets: {},
  agents: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  sql: (s: TemplateStringsArray) => s.join(''),
}))

const { getBudgetStatusTool } = await import('../lib/copilot/tools/get-budget-status')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:get_budget_status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
        where: vi.fn().mockResolvedValue([]),
      }),
    })
  })

  it('returns aggregated tenant budget when no agent_id', async () => {
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { agent_id: 'a1', agent_name: 'Atend', spent_usd: '4.21', limit_usd: '20.00' },
            { agent_id: 'a2', agent_name: 'Vendas', spent_usd: '1.50', limit_usd: '10.00' },
          ]),
        }),
      }),
    })
    const r = await getBudgetStatusTool.handler({}, ctx)
    expect(r.total_usd).toBeCloseTo(5.71, 2)
    expect(r.limit_usd).toBe(30)
    expect(r.by_agent).toHaveLength(2)
    expect(r.percent_used).toBeCloseTo((5.71 / 30) * 100, 1)
  })

  it('handles zero limit (unlimited) without divide-by-zero', async () => {
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ agent_id: 'a1', agent_name: 'X', spent_usd: '5', limit_usd: '0' }]),
        }),
      }),
    })
    const r = await getBudgetStatusTool.handler({}, ctx)
    expect(r.percent_used).toBe(0)
  })

  it('has admin_only permission', () => {
    expect(getBudgetStatusTool.permission).toBe('admin_only')
  })
})
