import { eq, and } from 'drizzle-orm'
import { getDb, agentEventSubscriptions } from '@ethra-nexus/db'

export type BusEventType =
  | 'budget_alert'
  | 'wiki_ingested'
  | 'webhook'
  | 'task_completed'
  | 'alert_triggered'

export interface QueuedEvent {
  subscription: {
    tenant_id: string
    agent_id: string
    skill_id: string
    input: Record<string, unknown>
    output_channel: string
  }
  payload: Record<string, unknown>
}

const eventQueue: QueuedEvent[] = []

export async function emitEvent(
  eventType: BusEventType,
  payload: Record<string, unknown>,
  tenantId: string,
  agentId?: string,
): Promise<void> {
  const db = getDb()

  try {
    const subscriptions = await db
      .select()
      .from(agentEventSubscriptions)
      .where(and(
        eq(agentEventSubscriptions.event_type, eventType),
        eq(agentEventSubscriptions.enabled, true),
        eq(agentEventSubscriptions.tenant_id, tenantId),
        ...(agentId ? [eq(agentEventSubscriptions.agent_id, agentId)] : []),
      ))

    const matched = subscriptions.filter((sub) =>
      matchesFilter(sub.event_filter as Record<string, unknown>, payload),
    )

    for (const sub of matched) {
      eventQueue.push({
        subscription: {
          tenant_id: sub.tenant_id,
          agent_id: sub.agent_id,
          skill_id: sub.skill_id,
          input: (sub.input ?? {}) as Record<string, unknown>,
          output_channel: sub.output_channel,
        },
        payload,
      })
    }
  } catch {
    // DB failure é non-fatal — event queue permanece inalterado
  }
}

export function drainEventQueue(): QueuedEvent[] {
  return eventQueue.splice(0, eventQueue.length)
}

// Verifica se o payload satisfaz todos os critérios do filtro (AND).
// Chaves suportadas: threshold (numérico >=), skill_id (igualdade), agent_id (igualdade).
// Filtro vazio → sempre corresponde.
export function matchesFilter(
  filter: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  if (Object.keys(filter).length === 0) return true

  if ('threshold' in filter) {
    if (Number(payload['threshold']) < Number(filter['threshold'])) return false
  }

  if ('skill_id' in filter) {
    if (payload['skill_id'] !== filter['skill_id']) return false
  }

  if ('agent_id' in filter) {
    if (payload['agent_id'] !== filter['agent_id']) return false
  }

  return true
}
