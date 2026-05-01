import type { FileStorageDriver } from './driver'
import { LocalFsDriver } from './local-fs.driver'

const DEFAULT_LOCAL_FS_ROOT = '/data/files'

export function createStorageDriver(): FileStorageDriver {
  const driver = process.env['FILE_STORAGE_DRIVER'] ?? 'local-fs'
  switch (driver) {
    case 'local-fs':
      return new LocalFsDriver(process.env['FILE_STORAGE_ROOT'] ?? DEFAULT_LOCAL_FS_ROOT)
    default:
      throw new Error(`Unknown FILE_STORAGE_DRIVER: ${driver}`)
  }
}
