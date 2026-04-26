import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AgentStatusBadge } from '@/components/agents/AgentStatusBadge'
import { useAgents, useDeleteAgent } from '@/hooks/useAgents'

export function AgentsPage() {
  const navigate = useNavigate()
  const { data: agents = [], isLoading } = useAgents()
  const deleteAgent = useDeleteAgent()
  const [search, setSearch] = useState('')

  const filtered = agents.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.role.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <div className="flex items-end justify-between mb-7">
        <div>
          <div className="font-mono uppercase tracking-[0.15em] text-[10px] text-muted-foreground mb-1">ETHRA NEXUS · AGENTES</div>
          <h1 className="text-2xl font-semibold text-foreground tracking-[-0.01em] mb-1">Agentes</h1>
          <p className="text-sm text-muted-foreground">{agents.length} agente{agents.length !== 1 ? 's' : ''} configurado{agents.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => navigate('/agents/new')} className="font-mono uppercase tracking-[0.1em]">
          <Plus size={14} className="mr-1.5" /> NOVO AGENTE
        </Button>
      </div>

      <div className="mb-5">
        <Input
          placeholder="Buscar por nome ou papel..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs font-mono"
        />
      </div>

      <div className="border-hairline overflow-hidden bg-card">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 border-b-hairline last:border-b-0">
                <Skeleton className="w-9 h-9" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-20 ml-auto" />
              </div>
            ))
          : filtered.length === 0
          ? (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                {search ? 'Nenhum agente encontrado.' : 'Nenhum agente criado ainda.'}
              </div>
            )
          : filtered.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-4 px-5 py-4 border-b-hairline last:border-b-0 hover:bg-secondary transition-colors cursor-pointer"
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <div className="w-9 h-9 border-hairline flex items-center justify-center text-base flex-shrink-0">
                  🤖
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{agent.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{agent.role}</p>
                </div>
                <AgentStatusBadge status={agent.status} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive ml-2"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Remover "${agent.name}"?`)) deleteAgent.mutate(agent.id)
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
      </div>
    </div>
  )
}
