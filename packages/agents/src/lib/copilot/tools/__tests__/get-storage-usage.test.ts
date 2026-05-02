import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = { execute: vi.fn() }
vi.mock('@ethra-nexus/db', () => ({ getDb: () => mockDb }))
vi.mock('drizzle-orm', () => ({ sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })) }))

const { getStorageUsageTool } = await import('../get-storage-usage')

describe('system_get_storage_usage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns usage with limit and pct', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ total: 5000, file_count: 10 }] })
      .mockResolvedValueOnce({ rows: [{ limit: 10000 }] })
      .mockResolvedValueOnce({ rows: [
        { code: 'soft_warning', count: 1 },
      ] })
    const result = await getStorageUsageTool.handler({}, { tenant_id: 't', user_id: 'u', user_role: 'admin' })
    expect(result.total_bytes).toBe(5000)
    expect(result.file_count).toBe(10)
    expect(result.limit_bytes).toBe(10000)
    expect(result.pct_used).toBe(0.5)
    expect(result.alerts_active.soft_warning).toBe(1)
    expect(result.alerts_active.hard_limit).toBe(0)
  })

  it('returns null pct when no limit set', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ total: 100, file_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ limit: null }] })
      .mockResolvedValueOnce({ rows: [] })
    const result = await getStorageUsageTool.handler({}, { tenant_id: 't', user_id: 'u', user_role: 'admin' })
    expect(result.limit_bytes).toBeNull()
    expect(result.pct_used).toBeNull()
  })
})
