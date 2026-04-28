import { describe, it, expect, vi } from 'vitest'

const mockExecute = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ execute: mockExecute }),
}))

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals }),
    { raw: (s: string) => ({ raw: s }),
    },
  ),
}))

const { costBreakdownTool } = await import('../lib/copilot/tools/cost-breakdown')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:cost_breakdown', () => {
  it('groups by agent', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { group_value: 'Atendimento', total_cost_usd: '12.34', total_tokens: '50000', event_count: '120' },
        { group_value: 'Vendas',      total_cost_usd: '3.21',  total_tokens: '12000', event_count: '40' },
      ],
    })
    const r = await costBreakdownTool.handler({ group_by: 'agent' }, ctx)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ group_value: 'Atendimento', total_cost_usd: 12.34, event_count: 120 })
  })

  it('rejects invalid group_by', async () => {
    // @ts-expect-error testing runtime check
    await expect(costBreakdownTool.handler({ group_by: 'invalid' }, ctx))
      .rejects.toThrow('Invalid group_by')
  })

  it('has admin_only permission', () => {
    expect(costBreakdownTool.permission).toBe('admin_only')
  })
})
