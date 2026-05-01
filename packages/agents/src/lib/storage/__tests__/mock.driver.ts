import { Readable } from 'stream'
import { createHash } from 'crypto'
import type { FileStorageDriver, PutArgs, PutResult, GetDownloadUrlOpts } from '../driver'

/**
 * In-memory storage driver for tests. Bytes are kept in a Map; never touches disk.
 * Use in route handler tests + alerts tests to avoid filesystem flakiness.
 */
export class MockStorageDriver implements FileStorageDriver {
  public readonly store = new Map<string, Buffer>()

  async put(args: PutArgs): Promise<PutResult> {
    const buf: Buffer = Buffer.isBuffer(args.bytes)
      ? args.bytes
      : await streamToBuffer(args.bytes as Readable)
    const storage_key = `${args.tenant_id}/${args.file_id}`
    this.store.set(storage_key, buf)
    return {
      storage_key,
      size_bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    }
  }

  async get(storage_key: string): Promise<NodeJS.ReadableStream | null> {
    const buf = this.store.get(storage_key)
    if (!buf) return null
    return Readable.from(buf)
  }

  async delete(storage_key: string): Promise<void> {
    this.store.delete(storage_key)
  }

  async getDownloadUrl(storage_key: string, _opts?: GetDownloadUrlOpts): Promise<string> {
    const file_id = storage_key.split('/').pop()
    return `/api/v1/files/${file_id}/download`
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}
