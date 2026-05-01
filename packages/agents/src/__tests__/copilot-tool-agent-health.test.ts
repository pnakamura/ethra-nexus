import { describe, it, expect, vi } from 'vitest'

const mockExecute = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ execute: mockExecute }),
}))

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
    { raw: (s: string) => ({ raw: s }),
    },
  ),
}))

const { agentHealthTool } = await import('../lib/copilot/tools/agent-health')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:agent_health', () => {
  it('returns success_rate, latency p95, top skills/errors', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: '100', errors: '5', p50: '500', p95: '2000' }] })
      .mockResolvedValueOnce({ rows: [{ skill_id: 'wiki:query', count: '60' }] })
      .mockResolvedValueOnce({ rows: [{ error_code: 'AI_ERROR', count: '3' }] })

    const r = await agentHealthTool.handler({ agent_id: 'a1' }, ctx)
    expect(r.total_events).toBe(100)
    expect(r.error_rate).toBe(0.05)
    expect(r.success_rate).toBe(0.95)
    expect(r.p50_latency_ms).toBe(500)
    expect(r.p95_latency_ms).toBe(2000)
    expect(r.top_skills).toHaveLength(1)
    expect(r.top_errors).toHaveLength(1)
  })

  it('handles empty data', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: '0', errors: '0', p50: null, p95: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await agentHealthTool.handler({ agent_id: 'a1' }, ctx)
    expect(r.total_events).toBe(0)
    expect(r.success_rate).toBe(0)
    expect(r.error_rate).toBe(0)
  })

  it('has all_members permission', () => {
    expect(agentHealthTool.permission).toBe('all_members')
  })
})
