import { Star } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useFeedback } from '@/hooks/useFeedback'
import { cn } from '@/lib/utils'

interface FeedbackSectionProps { agentId: string }

export function FeedbackSection({ agentId }: FeedbackSectionProps) {
  const { data, isLoading } = useFeedback(agentId)

  if (isLoading) {
    return <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
  }

  const avg = data?.meta.avg_rating ?? 0

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="flex items-center gap-4 p-4 bg-secondary/50 rounded-lg">
        <div className="text-center">
          <p className="font-serif text-3xl font-semibold text-foreground">{avg.toFixed(1)}</p>
          <p className="text-xs text-muted-foreground">média</p>
        </div>
        <div className="flex-1">
          <div className="flex gap-0.5 mb-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} size={16} className={cn('fill-current', n <= Math.round(avg) ? 'text-yellow-400' : 'text-muted-foreground/30')} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{data?.meta.total ?? 0} avaliações</p>
        </div>
      </div>

      {/* List */}
      {(data?.data.length ?? 0) === 0
        ? <p className="text-sm text-muted-foreground text-center py-4">Nenhum feedback ainda.</p>
        : data?.data.map((fb) => (
          <div key={fb.id} className="border border-border rounded-lg p-4 mist-item">
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={13} className={cn('fill-current', n <= fb.rating ? 'text-yellow-400' : 'text-muted-foreground/30')} />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{new Date(fb.created_at).toLocaleDateString('pt-BR')}</p>
            </div>
            {fb.comment && <p className="text-sm text-foreground">{fb.comment}</p>}
          </div>
        ))
      }
    </div>
  )
}
