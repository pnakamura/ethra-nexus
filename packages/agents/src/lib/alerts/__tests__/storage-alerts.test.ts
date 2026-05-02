import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(() => ({
    set: () => ({ where: () => Promise.resolve() }),
  })),
}
vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  // systemAlerts is consumed by storage-alerts.ts when calling
  // db.update(systemAlerts).set(...).where(inArray(systemAlerts.id, ids))
  systemAlerts: {
    id: 'systemAlerts.id',
    tenant_id: 'systemAlerts.tenant_id',
    category: 'systemAlerts.category',
    code: 'systemAlerts.code',
    resolved_at: 'systemAlerts.resolved_at',
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((c, v) => ({ eq: { c, v } })),
  and: vi.fn((...c) => ({ and: c })),
  isNull: vi.fn((c) => ({ isnull: c })),
  inArray: vi.fn((c, vals) => ({ inArray: { c, vals } })),
  sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })),
}))

const { computeStorageAlerts } = await import('../storage-alerts')

describe('computeStorageAlerts', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does nothing for tenants without storage_limit_bytes', async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] })  // no tenants with limit
    const stats = await computeStorageAlerts()
    expect(stats.created).toBe(0)
    expect(stats.resolved).toBe(0)
  })

  it('creates soft_warning at 75%', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1', limit: 1000 }] })  // tenants
      .mockResolvedValueOnce({ rows: [{ total: 750 }] })                    // usage
      .mockResolvedValueOnce({ rows: [] })                                  // existing active alerts
      .mockResolvedValueOnce({ rows: [] })                                  // insert returning
    const stats = await computeStorageAlerts()
    expect(stats.created).toBe(1)
    expect(stats.resolved).toBe(0)
  })

  it('upgrades soft_warning to migration_recommended at 90%', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1', limit: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ total: 900 }] })
      .mockResolvedValueOnce({ rows: [{ code: 'soft_warning', id: 'a1' }] })  // soft_warning is active
      .mockResolvedValueOnce({ rows: [] })  // insert migration_recommended
      .mockResolvedValueOnce({ rows: [] })  // resolve soft_warning
    const stats = await computeStorageAlerts()
    expect(stats.created).toBe(1)
    expect(stats.resolved).toBe(1)
  })

  it('resolves all alerts when usage drops below 70%', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ tenant_id: 't1', limit: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ total: 600 }] })
      .mockResolvedValueOnce({ rows: [
        { code: 'soft_warning', id: 'a1' },
        { code: 'hard_limit', id: 'a2' },
      ] })
      .mockResolvedValueOnce({ rows: [] })  // resolve all
    const stats = await computeStorageAlerts()
    expect(stats.created).toBe(0)
    expect(stats.resolved).toBe(2)
  })
})
