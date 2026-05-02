import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, accessSync, constants as fsc } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LocalFsDriver } from '../local-fs.driver'

describe('LocalFsDriver', () => {
  let root: string
  let driver: LocalFsDriver

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'localfs-test-'))
    driver = new LocalFsDriver(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('put writes bytes and returns metadata', async () => {
    const result = await driver.put({
      tenant_id: 'tenant-1',
      file_id: 'file-1',
      bytes: Buffer.from('hello world'),
      mime_type: 'text/plain',
    })
    expect(result.storage_key).toBe('tenant-1/file-1')
    expect(result.size_bytes).toBe(11)
    expect(result.sha256).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')

    const onDisk = readFileSync(join(root, 'tenant-1', 'file-1'))
    expect(onDisk.toString()).toBe('hello world')
  })

  it('put with empty bytes succeeds', async () => {
    const result = await driver.put({
      tenant_id: 't', file_id: 'f', bytes: Buffer.alloc(0), mime_type: 'application/octet-stream',
    })
    expect(result.size_bytes).toBe(0)
    expect(result.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('get returns stream with same bytes', async () => {
    await driver.put({ tenant_id: 't', file_id: 'f', bytes: Buffer.from('abc'), mime_type: 'text/plain' })
    const stream = await driver.get('t/f')
    expect(stream).not.toBeNull()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('abc')
  })

  it('get returns null for missing key', async () => {
    const result = await driver.get('does/not/exist')
    expect(result).toBeNull()
  })

  it('delete removes file from disk', async () => {
    await driver.put({ tenant_id: 't', file_id: 'f', bytes: Buffer.from('x'), mime_type: 'text/plain' })
    await driver.delete('t/f')
    expect(() => accessSync(join(root, 't', 'f'), fsc.F_OK)).toThrow()
  })

  it('delete is idempotent on missing key', async () => {
    await expect(driver.delete('never/existed')).resolves.toBeUndefined()
  })

  it('getDownloadUrl returns relative API path with file_id', async () => {
    const url = await driver.getDownloadUrl('tenant-1/file-1')
    expect(url).toBe('/api/v1/files/file-1/download')
  })
})
