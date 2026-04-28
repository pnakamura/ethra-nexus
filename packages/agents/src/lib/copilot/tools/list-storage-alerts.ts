import type { CopilotTool } from '../tool-registry'

interface ListStorageAlertsInput {
  level?: 'soft_warning' | 'migration_recommended' | 'hard_limit'
}

interface StorageAlert {
  level: string
  type: string
  message: string
  fired_at: string
}

// STUB: returns [] until Spec #2 (file storage + alerts) is implemented.
// When Spec #2 ships, replace handler body with real query against storage_alerts_fired.
export const listStorageAlertsTool: CopilotTool<ListStorageAlertsInput, StorageAlert[]> = {
  name: 'system:list_storage_alerts',
  description: 'Lista alertas de capacidade de storage (uploads, attachments) do tenant. Atualmente retorna lista vazia até o subsistema de storage ser implementado.',
  input_schema: {
    type: 'object',
    properties: {
      level: { type: 'string', enum: ['soft_warning', 'migration_recommended', 'hard_limit'] },
    },
  },
  permission: 'admin_only',
  handler: async () => [],
}
