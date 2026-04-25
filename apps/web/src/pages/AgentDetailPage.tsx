import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, User, Code2, BookOpen, DollarSign, Star } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { AgentStatusBadge } from '@/components/agents/AgentStatusBadge'
import { IdentitySection } from '@/components/agents/sections/IdentitySection'
import { SkillsSection } from '@/components/agents/sections/SkillsSection'
import { useAgent } from '@/hooks/useAgent'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'identity', label: 'Identidade', icon: User },
  { id: 'skills',   label: 'Skills',     icon: Code2 },
  { id: 'wiki',     label: 'Wiki',       icon: BookOpen },
  { id: 'budget',   label: 'Budget',     icon: DollarSign },
  { id: 'feedback', label: 'Feedback',   icon: Star },
]

export function AgentDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: agent, isLoading } = useAgent(id)

  const activeSection = location.hash.replace('#', '') || 'identity'
  const setSection = (s: string) => navigate({ hash: s }, { replace: true })

  return (
    <div className="mist-in">
      <button onClick={() => navigate('/agents')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors">
        <ArrowLeft size={14} /> Voltar para agentes
      </button>

      {/* Agent header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-accent/12 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
          🤖
        </div>
        <div className="flex-1">
          {isLoading
            ? <><Skeleton className="h-5 w-44 mb-1.5" /><Skeleton className="h-3.5 w-24" /></>
            : <>
                <h1 className="font-serif text-xl font-semibold text-foreground">{agent?.name}</h1>
                <p className="text-xs text-muted-foreground">{agent?.role}</p>
              </>
          }
        </div>
        {agent && <AgentStatusBadge status={agent.status} />}
      </div>

      {/* Split layout */}
      <div className="border border-border rounded-xl bg-card overflow-hidden flex min-h-[480px]">
        {/* Section nav */}
        <nav className="w-[160px] min-w-[160px] border-r border-border p-2 flex flex-col gap-0.5">
          {SECTIONS.map(({ id: sid, label, icon: Icon }) => (
            <button
              key={sid}
              onClick={() => setSection(sid)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors text-left',
                activeSection === sid
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/6',
              )}
            >
              <Icon size={14} className="flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        {/* Section content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {isLoading && !agent
            ? <div className="flex flex-col gap-4"><Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
            : agent
            ? <>
                {activeSection === 'identity' && <IdentitySection agent={agent} />}
                {activeSection === 'skills' && <SkillsSection agentId={agent.id} />}
                {activeSection === 'wiki' && (
                  <div className="text-sm text-muted-foreground py-4">
                    <p className="font-medium text-foreground mb-2">Wiki do agente</p>
                    <p>Acesse a interface do SilverBullet para gerenciar o conhecimento deste agente.</p>
                  </div>
                )}
                {activeSection === 'budget' && <BudgetSectionPlaceholder agentId={agent.id} />}
                {activeSection === 'feedback' && <FeedbackSectionPlaceholder agentId={agent.id} />}
              </>
            : null
          }
        </div>
      </div>
    </div>
  )
}

function BudgetSectionPlaceholder({ agentId }: { agentId: string }) {
  return <div className="text-sm text-muted-foreground">Budget — implementado na Task 11 (agentId: {agentId})</div>
}
function FeedbackSectionPlaceholder({ agentId }: { agentId: string }) {
  return <div className="text-sm text-muted-foreground">Feedback — implementado na Task 11 (agentId: {agentId})</div>
}
