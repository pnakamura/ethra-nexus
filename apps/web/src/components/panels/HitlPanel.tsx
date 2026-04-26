import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface AgentWrite {
  id: string
  agent_id: string
  page_title: string
  proposed_content: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s atrás`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m atrás`
  return `${Math.floor(diff / 3_600_000)}h atrás`
}

interface Props { agentId: string }

export function HitlPanel({ agentId }: Props) {
  const qc = useQueryClient()

  const { data: writes = [], isLoading } = useQuery({
    queryKey: ['agent-writes', agentId],
    queryFn: () =>
      api.get<{ data: AgentWrite[] }>('/wiki/agent-writes/pending')
        .then(r => r.data.data.filter(w => w.agent_id === agentId)),
    refetchInterval: 8000,
    enabled: !!agentId,
  })

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/wiki/agent-writes/${id}/approve`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agent-writes', agentId] }); toast.success('Aprovado') },
    onError: () => toast.error('Erro ao aprovar'),
  })

  const reject = useMutation({
    mutationFn: (id: string) => api.post(`/wiki/agent-writes/${id}/reject`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agent-writes', agentId] }); toast.success('Rejeitado') },
    onError: () => toast.error('Erro ao rejeitar'),
  })

  if (isLoading) {
    return (
      <div className="p-4 flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 bg-secondary animate-pulse" />
        ))}
      </div>
    )
  }

  if (!writes.length) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Nenhuma aprovação pendente
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0">
      {writes.map(write => (
        <div key={write.id} className="border-b-hairline p-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="font-mono text-[11px] text-foreground font-medium">
                {write.page_title}
              </p>
              <p className="font-mono text-[9px] text-muted-foreground mt-0.5">
                {relativeTime(write.created_at)}
              </p>
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-yellow-600 dark:text-yellow-400 flex-shrink-0">
              PENDING
            </span>
          </div>

          {/* Content preview */}
          <div className="bg-secondary p-3 mb-3 max-h-[120px] overflow-y-auto scrollbar-minimal">
            <p className="font-mono text-[10px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {write.proposed_content.slice(0, 400)}
              {write.proposed_content.length > 400 && '…'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => approve.mutate(write.id)}
              disabled={approve.isPending}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 h-8 font-mono text-[10px] uppercase tracking-[0.1em]',
                'bg-foreground text-background hover:opacity-80 transition-opacity disabled:opacity-40',
              )}
            >
              <Check size={11} /> APROVAR
            </button>
            <button
              onClick={() => reject.mutate(write.id)}
              disabled={reject.isPending}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 h-8 font-mono text-[10px] uppercase tracking-[0.1em]',
                'border-hairline text-muted-foreground hover:text-destructive hover:border-destructive transition-colors disabled:opacity-40',
              )}
            >
              <X size={11} /> REJEITAR
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
