import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'

export interface StorageAlertStats {
  tenants_processed: number
  created: number
  resolved: number
}

const SEVERITY: Record<string, 'info' | 'warning' | 'critical'> = {
  soft_warning: 'info',
  migration_recommended: 'warning',
  hard_limit: 'critical',
}

const CODES = ['soft_warning', 'migration_recommended', 'hard_limit'] as const
type StorageCode = typeof CODES[number]

function codeForPct(pct: number): StorageCode | null {
  if (pct >= 0.95) return 'hard_limit'
  if (pct >= 0.85) return 'migration_recommended'
  if (pct >= 0.70) return 'soft_warning'
  return null
}

export async function computeStorageAlerts(): Promise<StorageAlertStats> {
  const db = getDb()
  const stats: StorageAlertStats = { tenants_processed: 0, created: 0, resolved: 0 }

  const tenantsRes = await db.execute(sql`
    SELECT id AS tenant_id, storage_limit_bytes AS "limit"
    FROM tenants
    WHERE storage_limit_bytes IS NOT NULL
  `)

  for (const row of tenantsRes.rows as Array<{ tenant_id: string; limit: number | string }>) {
    const tenant_id = row.tenant_id
    const limit = typeof row.limit === 'string' ? parseInt(row.limit, 10) : row.limit
    if (!limit || limit <= 0) continue
    stats.tenants_processed++

    const usageRes = await db.execute(sql`
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
      FROM files
      WHERE tenant_id = ${tenant_id}
        AND (expires_at IS NULL OR expires_at > NOW())
    `)
    const usageRow = usageRes.rows[0] as { total: number | string }
    const current_bytes = typeof usageRow.total === 'string' ? parseInt(usageRow.total, 10) : usageRow.total
    const pct = current_bytes / limit
    const target = codeForPct(pct)

    const activeRes = await db.execute(sql`
      SELECT id, code FROM system_alerts
      WHERE tenant_id = ${tenant_id} AND category = 'storage' AND resolved_at IS NULL
    `)
    const activeRows = activeRes.rows as Array<{ id: string; code: string }>
    const activeCodes = new Set(activeRows.map(r => r.code))

    // Create target alert if it doesn't exist
    if (target && !activeCodes.has(target)) {
      await db.execute(sql`
        INSERT INTO system_alerts (tenant_id, category, code, severity, message, payload)
        VALUES (${tenant_id}, 'storage', ${target}, ${SEVERITY[target]},
                ${`Storage usage at ${(pct * 100).toFixed(1)}% — ${target}`},
                ${JSON.stringify({ current_bytes, limit_bytes: limit, pct })}::jsonb)
        ON CONFLICT DO NOTHING
      `)
      stats.created++
    }

    // Resolve any active code that is not the target
    const obsoleteIds = activeRows.filter(r => r.code !== target).map(r => r.id)
    if (obsoleteIds.length > 0) {
      await db.execute(sql`
        UPDATE system_alerts SET resolved_at = NOW()
        WHERE id = ANY(${obsoleteIds}::uuid[])
      `)
      stats.resolved += obsoleteIds.length
    }
  }

  return stats
}
