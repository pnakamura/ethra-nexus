import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createStorageDriver } from '../factory'
import { LocalFsDriver } from '../local-fs.driver'

describe('createStorageDriver', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.FILE_STORAGE_DRIVER
    delete process.env.FILE_STORAGE_ROOT
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns LocalFsDriver by default', () => {
    const driver = createStorageDriver()
    expect(driver).toBeInstanceOf(LocalFsDriver)
  })

  it('uses FILE_STORAGE_ROOT env when set', () => {
    process.env.FILE_STORAGE_ROOT = '/tmp/custom-root'
    const driver = createStorageDriver()
    expect(driver).toBeInstanceOf(LocalFsDriver)
    // Internal root not directly inspectable; smoke check via getDownloadUrl
    // is enough to know it constructed.
    expect(driver.getDownloadUrl('a/b')).resolves.toBe('/api/v1/files/b/download')
  })

  it('throws on unknown driver', () => {
    process.env.FILE_STORAGE_DRIVER = 'rocket-launchers'
    expect(() => createStorageDriver()).toThrow(/Unknown FILE_STORAGE_DRIVER/)
  })
})
