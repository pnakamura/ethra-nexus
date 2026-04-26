import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface AiosEvent {
  id: string
  skill_id: string
  status: 'running' | 'success' | 'error' | 'budget_exceeded' | 'rate_limited'
  triggered_by: string
  tokens_used: number | null
  cost_usd: number | null
  call_depth: number
  created_at: string
  completed_at: string | null
}

const STATUS_COLOR: Record<AiosEvent['status'], string> = {
  running:        'bg-blue-500',
  success:        'bg-green-500',
  error:          'bg-red-500',
  budget_exceeded:'bg-yellow-500',
  rate_limited:   'bg-orange-500',
}

const STATUS_LABEL: Record<AiosEvent['status'], string> = {
  running:        'RUNNING',
  success:        'OK',
  error:          'ERR',
  budget_exceeded:'BUDGET',
  rate_limited:   'LIMIT',
}

function latency(event: AiosEvent): string {
  if (!event.completed_at) return '—'
  const ms = new Date(event.completed_at).getTime() - new Date(event.created_at).getTime()
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s atrás`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m atrás`
  return `${Math.floor(diff / 3_600_000)}h atrás`
}

interface Props { agentId: string }

export function ExecutionLogPanel({ agentId }: Props) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['aios-events', agentId],
    queryFn: () =>
      api.get<{ data: AiosEvent[] }>('/aios/events', { params: { agent_id: agentId, limit: 50 } })
        .then(r => r.data.data),
    refetchInterval: 5000,
    enabled: !!agentId,
  })

  if (isLoading) {
    return (
      <div className="p-4 flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-secondary animate-pulse" />
        ))}
      </div>
    )
  }

  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Nenhuma execução
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {events.map(event => (
        <div
          key={event.id}
          className="flex items-center gap-3 px-4 py-2.5 border-b-hairline hover:bg-secondary/50 transition-colors"
        >
          {/* Status dot */}
          <span
            className={cn(
              'size-1.5 rounded-full flex-shrink-0',
              event.status === 'running' ? 'filament-pulse' : '',
              STATUS_COLOR[event.status],
            )}
          />

          {/* Skill + depth */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-foreground truncate">
                {event.skill_id}
              </span>
              {event.call_depth > 0 && (
                <span className="font-mono text-[9px] text-muted-foreground">
                  D{event.call_depth}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[9px] text-muted-foreground">
                {relativeTime(event.created_at)}
              </span>
              {event.cost_usd != null && (
                <span className="font-mono text-[9px] text-muted-foreground">
                  ${event.cost_usd.toFixed(4)}
                </span>
              )}
            </div>
          </div>

          {/* Status badge + latency */}
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <span className={cn(
              'font-mono text-[9px] uppercase tracking-[0.1em]',
              event.status === 'success' ? 'text-green-600 dark:text-green-400' :
              event.status === 'error'   ? 'text-red-500' : 'text-muted-foreground',
            )}>
              {STATUS_LABEL[event.status]}
            </span>
            <span className="font-mono text-[9px] text-muted-foreground">
              {latency(event)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
