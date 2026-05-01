import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import type { FileStorageDriver } from './driver'

/**
 * Removes files where expires_at < NOW. Deletes from driver first (best effort)
 * then from DB. Returns number of files removed.
 */
export async function cleanupExpiredFiles(driver: FileStorageDriver): Promise<number> {
  const db = getDb()
  const res = await db.execute(sql`
    SELECT id, tenant_id, storage_key
    FROM files
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
    LIMIT 500
  `)
  const rows = res.rows as Array<{ id: string; tenant_id: string; storage_key: string }>
  if (rows.length === 0) return 0

  for (const row of rows) {
    await driver.delete(row.storage_key).catch(() => undefined)  // best-effort
  }

  const ids = rows.map(r => r.id)
  await db.execute(sql`DELETE FROM files WHERE id = ANY(${ids}::uuid[])`)
  return rows.length
}
