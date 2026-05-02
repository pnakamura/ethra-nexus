import { promises as fs, createReadStream, createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { FileStorageDriver, PutArgs, PutResult, GetDownloadUrlOpts } from './driver'

export class LocalFsDriver implements FileStorageDriver {
  constructor(private readonly root: string) {}

  async put(args: PutArgs): Promise<PutResult> {
    const storage_key = `${args.tenant_id}/${args.file_id}`
    const path = join(this.root, storage_key)
    await fs.mkdir(dirname(path), { recursive: true })

    const hash = createHash('sha256')
    let size = 0

    const source: Readable = Buffer.isBuffer(args.bytes)
      ? Readable.from(args.bytes)
      : (args.bytes as Readable)

    // Tee: hash + size counting + write
    source.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      size += chunk.length
    })

    await pipeline(source, createWriteStream(path))

    return {
      storage_key,
      size_bytes: size,
      sha256: hash.digest('hex'),
    }
  }

  async get(storage_key: string): Promise<NodeJS.ReadableStream | null> {
    const path = join(this.root, storage_key)
    try {
      await fs.access(path)
    } catch {
      return null
    }
    return createReadStream(path)
  }

  async delete(storage_key: string): Promise<void> {
    const path = join(this.root, storage_key)
    try {
      await fs.unlink(path)
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'ENOENT') throw err
    }
  }

  async getDownloadUrl(storage_key: string, _opts?: GetDownloadUrlOpts): Promise<string> {
    // storage_key is "<tenant_id>/<file_id>"; return path keyed only on file_id
    // since the API endpoint resolves tenant from JWT.
    const file_id = storage_key.split('/').pop()
    return `/api/v1/files/${file_id}/download`
  }
}
