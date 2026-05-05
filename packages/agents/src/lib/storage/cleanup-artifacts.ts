import { getDb, artifacts } from '@ethra-nexus/db'
import { lt, inArray } from 'drizzle-orm'
import type { FileStorageDriver } from './driver'

const CLEANUP_BATCH_SIZE = 100

/**
 * Delete expired artifacts (expires_at < NOW) and their bytes from storage.
 * Idempotent. Designed to be called daily by scheduler-loop.
 *
 * Returns count of deleted artifacts.
 */
export async function cleanupExpiredArtifacts(driver: FileStorageDriver): Promise<number> {
  const db = getDb()
  const now = new Date()

  // Fetch a batch of expired artifacts
  const expired = await db
    .select({ id: artifacts.id, storage_key: artifacts.storage_key })
    .from(artifacts)
    .where(lt(artifacts.expires_at, now))
    .limit(CLEANUP_BATCH_SIZE)

  if (expired.length === 0) return 0

  // Delete bytes via driver (best-effort; idempotent)
  for (const row of expired) {
    try {
      await driver.delete(row.storage_key)
    } catch {
      // log but continue; best-effort cleanup
    }
  }

  // Delete DB rows
  const ids = expired.map(r => r.id)
  await db.delete(artifacts).where(inArray(artifacts.id, ids))

  return expired.length
}
