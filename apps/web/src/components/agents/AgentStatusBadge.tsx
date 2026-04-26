import { cn } from '@/lib/utils'

interface AgentStatusBadgeProps { status: string }

export function AgentStatusBadge({ status }: AgentStatusBadgeProps) {
  const isActive = status === 'active'
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] px-2 py-0.5 border-hairline',
      isActive ? 'text-foreground' : 'text-muted-foreground',
    )}>
      <span
        className={cn('size-1.5 rounded-full', isActive && 'filament-pulse')}
        style={{ background: isActive ? 'hsl(var(--status-active))' : 'hsl(var(--status-idle))' }}
      />
      {isActive ? 'ACTIVE' : 'IDLE'}
    </span>
  )
}
