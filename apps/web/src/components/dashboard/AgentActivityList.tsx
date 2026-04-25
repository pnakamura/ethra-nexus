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
    <Card>
      <CardHeader className="pb-3">
        <h2 className="font-serif text-base font-semibold text-foreground">Agentes recentes</h2>
      </CardHeader>
      <CardContent className="p-0">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3 border-t border-border first:border-t-0">
                <Skeleton className="w-9 h-9 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-3.5 w-36 mb-1.5" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
            ))
          : agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-3 px-5 py-3 border-t border-border first:border-t-0 cursor-pointer hover:bg-accent/5 transition-colors mist-item"
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <div className="w-9 h-9 bg-accent/12 rounded-lg flex items-center justify-center text-base">
                  🤖
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-serif text-sm font-medium text-foreground truncate">{agent.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{agent.skills.slice(0, 2).join(' · ')}</p>
                </div>
                <span className={cn(
                  'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full',
                  agent.status === 'active'
                    ? 'bg-green-500/10 text-green-700 border border-green-500/20 halo-pulse'
                    : 'bg-yellow-500/10 text-yellow-700 border border-yellow-500/20',
                )}>
                  {agent.status === 'active' && <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />}
                  {agent.status === 'active' ? 'Ativo' : 'Pausado'}
                </span>
              </div>
            ))}
      </CardContent>
    </Card>
  )
}
