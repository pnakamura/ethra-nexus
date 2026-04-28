import { Wrench, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  toolName: string
  durationMs?: number
  status?: 'running' | 'completed' | 'error'
  onClick?: () => void
}

export function ToolUseInlineMarker({ toolName, durationMs, status = 'completed', onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-hairline px-2 py-1 my-1 font-mono text-[10px] hover:bg-secondary transition-colors',
        status === 'error' && 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-400',
        status === 'running' && 'animate-pulse',
      )}
    >
      <Wrench size={10} />
      <span>{toolName}</span>
      {durationMs !== undefined && <span className="text-muted-foreground">{durationMs}ms</span>}
      <ChevronRight size={10} className="opacity-40" />
    </button>
  )
}
