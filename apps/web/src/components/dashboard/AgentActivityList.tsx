import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface RecentAgent {
  id: string
  name: string
  role: string
  status: string
  skills: string[]
}

interface AgentActivityListProps {
  agents: RecentAgent[]
  loading?: boolean
}

export function AgentActivityList({ agents, loading }: AgentActivityListProps) {
  const navigate = useNavigate()

  return (
    <Card className="border-hairline shadow-none">
      <CardHeader className="pb-3 border-b-hairline">
        <h2 className="font-mono uppercase tracking-[0.12em] text-xs text-muted-foreground">Agent Roster</h2>
      </CardHeader>
      <CardContent className="p-0">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-t-hairline first:border-t-0">
                <Skeleton className="w-8 h-8" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-36 mb-1.5" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))
          : agents.map((agent) => {
              const isActive = agent.status === 'active'
              return (
                <div
                  key={agent.id}
                  className="flex items-center gap-3 px-4 py-3 border-t-hairline first:border-t-0 cursor-pointer hover:bg-secondary transition-colors"
                  onClick={() => navigate(`/agents/${agent.id}`)}
                >
                  <div className="w-8 h-8 bg-secondary flex items-center justify-center text-sm">
                    🤖
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground truncate">
                      {agent.skills.slice(0, 2).join(' · ')}
                    </p>
                  </div>
                  <span className={cn(
                    'inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em]',
                    isActive ? 'text-foreground' : 'text-muted-foreground',
                  )}>
                    <span
                      className={cn('size-1.5 rounded-full', isActive && 'filament-pulse')}
                      style={{ background: isActive ? 'hsl(var(--status-active))' : 'hsl(var(--status-idle))' }}
                    />
                    {isActive ? 'ACTIVE' : 'IDLE'}
                  </span>
                </div>
              )
            })}
      </CardContent>
    </Card>
  )
}
