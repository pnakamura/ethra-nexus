import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useCopilotConversations,
  useCreateCopilotConversation,
  useDeleteCopilotConversation,
  type CopilotConversation,
} from '@/hooks/useCopilot'

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'agora'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function ConversationsSidebar({ selectedId, onSelect }: Props) {
  const { data: convs = [], isLoading } = useCopilotConversations({ status: 'active' })
  const create = useCreateCopilotConversation()
  const del = useDeleteCopilotConversation()

  async function handleNewConversation() {
    const created = await create.mutateAsync()
    onSelect(created.id)
  }

  function handleDelete(e: React.MouseEvent, conv: CopilotConversation) {
    e.stopPropagation()
    if (!confirm(`Arquivar "${conv.title ?? 'conversa sem título'}"?`)) return
    del.mutate(conv.id, {
      onSuccess: () => {
        if (selectedId === conv.id) onSelect(null)
      },
    })
  }

  return (
    <aside className="w-[220px] flex-shrink-0 border-r-hairline flex flex-col bg-background overflow-hidden">
      <div className="p-3 border-b-hairline">
        <button
          onClick={handleNewConversation}
          disabled={create.isPending}
          className="w-full flex items-center justify-center gap-1.5 h-9 border-hairline hover:bg-secondary transition-colors text-[12px] font-mono uppercase tracking-[0.08em]"
        >
          <Plus size={12} />
          Nova conversa
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-minimal">
        {isLoading && (
          <div className="p-3 flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        )}

        {!isLoading && convs.length === 0 && (
          <p className="p-4 text-[11px] text-muted-foreground text-center">
            Sem conversas. Clique em "Nova conversa" para começar.
          </p>
        )}

        {!isLoading && convs.map(conv => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={cn(
              'w-full text-left px-3 py-2.5 border-b-hairline hover:bg-secondary transition-colors group',
              selectedId === conv.id && 'bg-secondary',
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-0.5">
              <p className={cn(
                'text-[12px] font-medium truncate flex-1',
                conv.title ? 'text-foreground' : 'text-muted-foreground italic',
              )}>
                {conv.title ?? 'sem título'}
              </p>
              <button
                onClick={(e) => handleDelete(e, conv)}
                className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Arquivar"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>{conv.message_count} msg</span>
              <span>há {relTime(conv.last_message_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
