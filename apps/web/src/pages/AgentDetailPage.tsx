import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, User, Code2, BookOpen, DollarSign, Star, Clock, Play } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { AgentStatusBadge } from '@/components/agents/AgentStatusBadge'
import { IdentitySection } from '@/components/agents/sections/IdentitySection'
import { SkillsSection } from '@/components/agents/sections/SkillsSection'
import { BudgetSection } from '@/components/agents/sections/BudgetSection'
import { FeedbackSection } from '@/components/agents/sections/FeedbackSection'
import { SchedulesSection } from '@/components/agents/sections/SchedulesSection'
import { ExecuteSection } from '@/components/agents/sections/ExecuteSection'
import { SplitLayout } from '@/components/layout/SplitLayout'
import { ExecutionLogPanel } from '@/components/panels/ExecutionLogPanel'
import { HitlPanel } from '@/components/panels/HitlPanel'
import { useAgent } from '@/hooks/useAgent'
import { cn } from '@/lib/utils'

const SECTIONS = [
  { id: 'identity',   label: 'Identidade', icon: User },
  { id: 'skills',     label: 'Skills',     icon: Code2 },
  { id: 'wiki',       label: 'Wiki',       icon: BookOpen },
  { id: 'budget',     label: 'Budget',     icon: DollarSign },
  { id: 'feedback',   label: 'Feedback',   icon: Star },
  { id: 'schedules',  label: 'Schedules',  icon: Clock },
  { id: 'execute',    label: 'Executar',   icon: Play },
]

export function AgentDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: agent, isLoading } = useAgent(id)

  const activeSection = location.hash.replace('#', '') || 'identity'
  const setSection = (s: string) => navigate({ hash: s }, { replace: true })

  const panelTabs = [
    { id: 'log',  label: 'Execução',  content: <ExecutionLogPanel agentId={id} /> },
    { id: 'hitl', label: 'Aprovações', content: <HitlPanel agentId={id} /> },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Agent header */}
      <div className="flex-shrink-0 mb-5">
        <button
          onClick={() => navigate('/agents')}
          className="flex items-center gap-1.5 font-mono uppercase tracking-[0.12em] text-xs text-muted-foreground hover:text-foreground mb-5 transition-colors"
        >
          <ArrowLeft size={12} /> AGENTES
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-hairline flex items-center justify-center text-lg flex-shrink-0">
            🤖
          </div>
          <div className="flex-1">
            {isLoading
              ? <><Skeleton className="h-5 w-44 mb-1.5" /><Skeleton className="h-3.5 w-24" /></>
              : <>
                  <h1 className="text-xl font-semibold text-foreground tracking-[-0.01em]">{agent?.name}</h1>
                  <p className="font-mono text-[11px] text-muted-foreground">{agent?.role}</p>
                </>
            }
          </div>
          {agent && <AgentStatusBadge status={agent.status} />}
        </div>
      </div>

      {/* Split layout — main: nav+content, panel: log+hitl */}
      <div className="border-hairline bg-card flex-1 overflow-hidden flex flex-col min-h-[480px]">
        <SplitLayout
          tabs={panelTabs}
          defaultTab="log"
          storageKey="agent-detail"
          defaultPanelWidth={340}
        >
          <div className="flex h-full">
            {/* Section nav */}
            <nav className="w-[180px] min-w-[180px] border-r-hairline p-2 flex flex-col gap-0.5 flex-shrink-0">
              {SECTIONS.map(({ id: sid, label, icon: Icon }) => (
                <button
                  key={sid}
                  onClick={() => setSection(sid)}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors text-left border-l-2',
                    activeSection === sid
                      ? 'bg-secondary text-foreground border-l-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary border-l-transparent',
                  )}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  {label}
                </button>
              ))}
            </nav>

            {/* Section content */}
            <div className="flex-1 p-6 overflow-y-auto scrollbar-minimal">
              {isLoading && !agent
                ? <div className="flex flex-col gap-4"><Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" /><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
                : agent
                ? <>
                    {activeSection === 'identity' && <IdentitySection agent={agent} />}
                    {activeSection === 'skills'   && <SkillsSection agentId={agent.id} />}
                    {activeSection === 'wiki'     && (
                      <div className="text-sm text-muted-foreground py-4">
                        <p className="font-medium text-foreground mb-2">Wiki do agente</p>
                        <p>Acesse a interface do SilverBullet para gerenciar o conhecimento deste agente.</p>
                      </div>
                    )}
                    {activeSection === 'budget'   && <BudgetSection agentId={agent.id} />}
                    {activeSection === 'feedback' && <FeedbackSection agentId={agent.id} />}
                    {activeSection === 'schedules' && <SchedulesSection agentId={agent.id} />}
                    {activeSection === 'execute'   && <ExecuteSection agentId={agent.id} />}
                  </>
                : null
              }
            </div>
          </div>
        </SplitLayout>
      </div>
    </div>
  )
}
