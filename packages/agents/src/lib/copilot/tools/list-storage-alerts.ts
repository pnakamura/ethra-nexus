import { eq, and, isNull, desc } from 'drizzle-orm'
import { getDb, systemAlerts } from '@ethra-nexus/db'
import type { CopilotTool } from '../tool-registry'

interface Input {
  level?: 'soft_warning' | 'migration_recommended' | 'hard_limit'
}

interface AlertView {
  code: string
  severity: string
  message: string
  payload: unknown
  fired_at: Date
}

interface Output {
  alerts: AlertView[]
}

export const listStorageAlertsTool: CopilotTool<Input, Output> = {
  name: 'system:list_storage_alerts',
  description: 'Lista alertas ativos de storage do tenant. Retorna apenas não-resolvidos. Pode filtrar por level (soft_warning, migration_recommended, hard_limit).',
  input_schema: {
    type: 'object',
    properties: {
      level: {
        type: 'string',
        enum: ['soft_warning', 'migration_recommended', 'hard_limit'],
        description: 'Filtra apenas alerts deste código.',
      },
    },
  },
  permission: 'admin_only',
  handler: async (input, ctx) => {
    const db = getDb()
    const conditions = [
      eq(systemAlerts.tenant_id, ctx.tenant_id),
      eq(systemAlerts.category, 'storage'),
      isNull(systemAlerts.resolved_at),
    ]
    if (input.level) conditions.push(eq(systemAlerts.code, input.level))

    const rows = await db.select({
      code: systemAlerts.code,
      severity: systemAlerts.severity,
      message: systemAlerts.message,
      payload: systemAlerts.payload,
      fired_at: systemAlerts.fired_at,
    })
      .from(systemAlerts)
      .where(and(...conditions))
      .orderBy(desc(systemAlerts.fired_at))

    return { alerts: rows as AlertView[] }
  },
}
