import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelect = vi.fn()
const mockLimit = vi.fn()

vi.mock('@ethra-nexus/db', () => ({
  getDb: () => ({ select: mockSelect }),
  wikiAgentWrites: {},
  agents: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ c, v })),
  and: vi.fn((...c) => ({ c })),
  desc: vi.fn((c) => ({ desc: c })),
}))

const { listPendingApprovalsTool } = await import('../lib/copilot/tools/list-pending-approvals')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:list_pending_approvals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('returns pending writes with content_preview truncated', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 'w1', agent_name: 'Atend',
      slug: 'devolucao', title: 'Política de devolução',
      content: 'A'.repeat(500),
      target_wiki: 'strategic', created_at: new Date('2026-04-27T10:00:00Z'),
    }])
    const r = await listPendingApprovalsTool.handler({}, ctx)
    expect(r).toHaveLength(1)
    expect(r[0]?.content_preview).toHaveLength(200)
    expect(r[0]?.title).toBe('Política de devolução')
  })

  it('has admin_only permission', () => {
    expect(listPendingApprovalsTool.permission).toBe('admin_only')
  })
})
