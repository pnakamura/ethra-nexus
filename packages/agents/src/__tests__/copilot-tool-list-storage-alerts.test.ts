import { describe, it, expect } from 'vitest'

const { listStorageAlertsTool } = await import('../lib/copilot/tools/list-storage-alerts')

const ctx = { tenant_id: 't1', user_id: 'u1', user_role: 'admin' as const }

describe('system:list_storage_alerts', () => {
  it('returns empty array (stub until Spec #2)', async () => {
    const r = await listStorageAlertsTool.handler({}, ctx)
    expect(r).toEqual([])
  })

  it('has admin_only permission', () => {
    expect(listStorageAlertsTool.permission).toBe('admin_only')
  })
})
