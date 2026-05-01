import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockStorageDriver } from './mock.driver'

const mockDb = { execute: vi.fn() }
vi.mock('@ethra-nexus/db', () => ({ getDb: () => mockDb }))
vi.mock('drizzle-orm', () => ({ sql: vi.fn((parts, ...vals) => ({ sql: { parts, vals } })) }))

const { cleanupExpiredFiles } = await import('../cleanup')

describe('cleanupExpiredFiles', () => {
  beforeEach(() => { vi.clearAllMocks() })

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
