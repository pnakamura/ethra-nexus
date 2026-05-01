import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = { select: vi.fn() }
vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  systemAlerts: {
    tenant_id: 'tenant_id_col',
    category: 'category_col',
    code: 'code_col',
    severity: 'severity_col',
    message: 'message_col',
    payload: 'payload_col',
    fired_at: 'fired_at_col',
    resolved_at: 'resolved_at_col',
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c.filter(Boolean) })),
  isNull: vi.fn((c) => ({ isnull: c })),
  desc: vi.fn((c) => ({ desc: c })),
}))

const { listStorageAlertsTool } = await import('../list-storage-alerts')

describe('system_list_storage_alerts', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns active alerts for the tenant', async () => {
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => Promise.resolve([
        { code: 'soft_warning', severity: 'info', message: 'm', payload: { pct: 0.75 }, fired_at: new Date() },
      ]) }) })
    })
    const result = await listStorageAlertsTool.handler({}, { tenant_id: 't1', user_id: 'u', user_role: 'admin' })
    expect(result.alerts).toHaveLength(1)
    expect(result.alerts[0]?.code).toBe('soft_warning')
  })

  it('filters by level when passed', async () => {
    mockDb.select.mockReturnValueOnce({
      from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) })
    })
    const result = await listStorageAlertsTool.handler({ level: 'hard_limit' }, { tenant_id: 't1', user_id: 'u', user_role: 'admin' })
    expect(result.alerts).toEqual([])
  })
})
