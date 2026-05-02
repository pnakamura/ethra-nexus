import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockStorageDriver } from './mock.driver'

const mockDb = {
  execute: vi.fn(),
  // delete() chain consumed by cleanup.ts:
  //   db.delete(files).where(inArray(files.id, ids))
  delete: vi.fn(() => ({
    where: () => Promise.resolve(),
  })),
}
vi.mock('@ethra-nexus/db', () => ({
  getDb: () => mockDb,
  files: {
    id: 'files.id',
    tenant_id: 'files.tenant_id',
    storage_key: 'files.storage_key',
    expires_at: 'files.expires_at',
  },
}))
vi.mock('drizzle-orm', () => ({
  sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })),
  inArray: vi.fn((c, vals) => ({ inArray: { c, vals } })),
}))

const { cleanupExpiredFiles } = await import('../cleanup')

describe('cleanupExpiredFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-setup the chain mock for db.delete(files).where(...) after clear.
    mockDb.delete.mockImplementation(() => ({
      where: () => Promise.resolve(),
    }))
  })

  it('returns 0 when no expired files', async () => {
    const driver = new MockStorageDriver()
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] })  // SELECT expired
    const count = await cleanupExpiredFiles(driver)
    expect(count).toBe(0)
  })

  it('deletes from driver and DB for each expired file', async () => {
    const driver = new MockStorageDriver()
    driver.store.set('t1/f1', Buffer.from('data1'))
    driver.store.set('t1/f2', Buffer.from('data2'))
    mockDb.execute
      .mockResolvedValueOnce({ rows: [
        { id: 'f1', tenant_id: 't1', storage_key: 't1/f1' },
        { id: 'f2', tenant_id: 't1', storage_key: 't1/f2' },
      ] })
      .mockResolvedValueOnce({ rows: [] })  // DELETE rows
    const count = await cleanupExpiredFiles(driver)
    expect(count).toBe(2)
    expect(driver.store.has('t1/f1')).toBe(false)
    expect(driver.store.has('t1/f2')).toBe(false)
  })
})
