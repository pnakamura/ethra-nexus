import { sql } from 'drizzle-orm'
import { getDb } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface Output {
  total_bytes: number
  file_count: number
  limit_bytes: number | null
  pct_used: number | null
  alerts_active: { soft_warning: number; migration_recommended: number; hard_limit: number }
}

export const getStorageUsageTool: CopilotTool<Record<string, never>, Output> = {
  name: 'system:get_storage_usage',
  description: 'Retorna uso atual de storage do tenant (bytes, file_count, % do limite, contagem de alertas ativos por código).',
  input_schema: { type: 'object', properties: {} },
  permission: 'admin_only',
  handler: async (_input, ctx) => {
    const db = getDb()

    const usageRes = await db.execute(sql`
      SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total,
             COUNT(*)::int AS file_count
      FROM files
      WHERE tenant_id = ${ctx.tenant_id}
        AND (expires_at IS NULL OR expires_at > NOW())
    `)
    const usage = usageRes.rows[0] as { total: number | string; file_count: number }
    const total_bytes = typeof usage.total === 'string' ? parseInt(usage.total, 10) : usage.total
    const file_count = usage.file_count

    const limitRes = await db.execute(sql`
      SELECT storage_limit_bytes AS "limit" FROM tenants WHERE id = ${ctx.tenant_id}
    `)
    const limitRaw = (limitRes.rows[0] as { limit: number | string | null }).limit
    const limit_bytes: number | null = limitRaw === null ? null
      : typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : limitRaw
    const pct_used = limit_bytes ? total_bytes / limit_bytes : null

    const alertsRes = await db.execute(sql`
      SELECT code, COUNT(*)::int AS count
      FROM system_alerts
      WHERE tenant_id = ${ctx.tenant_id}
        AND category = 'storage'
        AND resolved_at IS NULL
      GROUP BY code
    `)
    const alerts_active = { soft_warning: 0, migration_recommended: 0, hard_limit: 0 }
    for (const row of alertsRes.rows as Array<{ code: string; count: number }>) {
      if (row.code in alerts_active) {
        (alerts_active as Record<string, number>)[row.code] = row.count
      }
    }

    return { total_bytes, file_count, limit_bytes, pct_used, alerts_active }
  },
}
