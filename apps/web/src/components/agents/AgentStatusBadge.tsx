import { cn } from '@/lib/utils'

interface AgentStatusBadgeProps { status: string }

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const isActive = status === 'active'
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border',
      isActive
        ? 'bg-green-500/10 text-green-700 border-green-500/20 halo-pulse'
        : 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
    )}>
      {isActive && <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />}
      {isActive ? 'Ativo' : 'Pausado'}
    </span>
  )
}
