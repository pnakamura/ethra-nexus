import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Activity,
  Bot,
  LayoutGrid,
  MessageSquare,
  Plus,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Send,
  Clock,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAgents } from '@/hooks/useAgents'
import { useWikiApprovals, useApproveWrite, useRejectWrite } from '@/hooks/useWiki'
import {
  useAiosEvents,
  useDashboardStats,
  useOrchestratorExecute,
} from '@/hooks/useOrchestrator'
import type { AiosEvent } from '@/hooks/useOrchestrator'
import type { Agent } from '@/lib/schemas/agent.schema'
import type { WikiApproval } from '@/hooks/useWiki'

// ─── Constants ────────────────────────────────────────────────────────────────

const BUDGET_SOFT_LIMIT_USD = 10

const SKILL_LABELS: Record<string, string> = {
  'wiki:query':        'Wiki · Consulta',
  'wiki:ingest':       'Wiki · Ingestão',
  'wiki:lint':         'Wiki · Lint',
  'channel:respond':   'Canal · Resposta',
  'channel:proactive': 'Canal · Proativo',
  'report:generate':   'Relatório',
  'monitor:health':    'Monitor · Health',
  'monitor:alert':     'Monitor · Alerta',
  'data:analyze':      'Dados · Análise',
  'data:extract':      'Dados · Extração',
}

const SKILL_MODELS: Record<string, string> = {
  'wiki:query':        'claude-sonnet-4-6',
  'wiki:ingest':       'claude-sonnet-4-6',
  'wiki:lint':         'groq/llama-3.3-70b',
  'channel:respond':   'claude-sonnet-4-6',
  'channel:proactive': 'claude-sonnet-4-6',
  'report:generate':   'claude-opus-4-7',
  'monitor:health':    'groq/llama-3.1-8b',
  'monitor:alert':     'groq/llama-3.1-8b',
  'data:analyze':      'gemini-2.0-flash',
  'data:extract':      'claude-sonnet-4-6',
}

const ALL_SKILLS = Object.keys(SKILL_LABELS)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function skillLabel(id: string) {
  return SKILL_LABELS[id] ?? id
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'agora'
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function daysUntilReset(): number {
  const now = new Date()
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return Math.ceil((next.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function latencyMs(event: AiosEvent): string | null {
  if (!event.completed_at) return null
  const ms = new Date(event.completed_at).getTime() - new Date(event.started_at).getTime()
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function extractInputText(payload: Record<string, unknown> | null): string {
  if (!payload) return '(sem input)'
  if (typeof payload['query'] === 'string') return payload['query']
  if (typeof payload['message'] === 'string') return payload['message']
  if (typeof payload['content'] === 'string') return payload['content'].slice(0, 200)
  return JSON.stringify(payload, null, 2)
}

function extractResultText(result: Record<string, unknown> | null): string {
  if (!result) return ''
  if (typeof result['content'] === 'string') return result['content']
  if (typeof result['text'] === 'string') return result['text']
  if (typeof result['answer'] === 'string') return result['answer']
  return JSON.stringify(result, null, 2).slice(0, 500)
}

interface EnrichedEvent extends AiosEvent {
  agent?: Agent
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusDotClass(status: string): string {
  const map: Record<string, string> = {
    pending:   'bg-muted-foreground/40 border border-border',
    running:   'bg-green-500 animate-pulse',
    completed: 'bg-green-500',
    failed:    'bg-red-500',
  }
  return map[status] ?? 'bg-muted-foreground/40'
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending:   'Pendente',
    running:   'Em execução',
    completed: 'Concluído',
    failed:    'Falhou',
  }
  return map[status] ?? status
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    pending:   'bg-secondary text-muted-foreground',
    running:   'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    completed: 'bg-secondary text-muted-foreground',
    failed:    'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  }
  return map[status] ?? 'bg-secondary text-muted-foreground'
}

// ─── LeftSidebar ─────────────────────────────────────────────────────────────

function LeftSidebar({
  agents,
  costMonth,
  pendingHitl,
  selectedAgentId,
  onSelectAgent,
}: {
  agents: Agent[]
  costMonth: number
  pendingHitl: number
  selectedAgentId: string | null
  onSelectAgent: (id: string | null) => void
}) {
  const pct = Math.min((costMonth / BUDGET_SOFT_LIMIT_USD) * 100, 100)
  const barColor = pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-foreground'
  const days = daysUntilReset()

  return (
    <aside className="w-52 border-r-hairline flex-shrink-0 flex flex-col overflow-hidden bg-background">
      {/* Budget gauge */}
      <div className="border-b-hairline px-4 py-3.5">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
          Budget mensal
        </div>
        <div className="flex items-end justify-between mb-1.5">
          <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
            ${costMonth.toFixed(2)}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            / ${BUDGET_SOFT_LIMIT_USD}
          </span>
        </div>
        <div className="h-[3px] bg-secondary w-full">
          <div
            className={cn('h-full transition-all', barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="font-mono text-[9px] text-muted-foreground mt-1.5">
          {pct.toFixed(0)}% · reseta em {days}d
        </p>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto">
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground px-4 pt-3 pb-1.5">
          Agentes
        </div>
        <button
          onClick={() => onSelectAgent(null)}
          className={cn(
            'w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-secondary transition-colors border-l-2',
            selectedAgentId === null
              ? 'border-l-primary bg-secondary'
              : 'border-l-transparent',
          )}
        >
          <Activity size={11} className="text-muted-foreground flex-shrink-0" />
          <span className={cn('text-[11px] truncate', selectedAgentId === null ? 'font-medium text-foreground' : 'text-muted-foreground')}>
            Todos
          </span>
        </button>
        {agents.map(a => (
          <button
            key={a.id}
            onClick={() => onSelectAgent(a.id)}
            className={cn(
              'w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-secondary transition-colors border-l-2',
              selectedAgentId === a.id
                ? 'border-l-primary bg-secondary'
                : 'border-l-transparent',
            )}
          >
            <span
              className={cn('size-1.5 rounded-full flex-shrink-0', statusDotClass(a.status))}
            />
            <span className={cn('text-[11px] truncate flex-1', selectedAgentId === a.id ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              {a.name}
            </span>
          </button>
        ))}
      </div>

      {/* HITL indicator */}
      {pendingHitl > 0 && (
        <div className="border-t-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
            <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400">
              {pendingHitl} aprovação{pendingHitl > 1 ? 'ões' : ''} pendente{pendingHitl > 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}
    </aside>
  )
}

// ─── TaskHeader ───────────────────────────────────────────────────────────────

function TaskHeader({ event }: { event: EnrichedEvent | undefined }) {
  if (!event) {
    return (
      <div className="h-12 border-b-hairline flex items-center px-5 bg-background flex-shrink-0">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.12em]">
          Selecione uma execução
        </span>
      </div>
    )
  }

  return (
    <div className="h-12 border-b-hairline flex items-center gap-3 px-5 bg-background flex-shrink-0">
      <span className="font-mono text-[10px] text-muted-foreground flex-shrink-0">
        #{event.id.slice(0, 8)}
      </span>
      <span className="text-[13px] font-medium text-foreground truncate flex-1">
        {skillLabel(event.skill_id)}
        {event.agent && ` · ${event.agent.name}`}
      </span>
      <span
        className={cn(
          'font-mono text-[9px] px-2 py-0.5 uppercase tracking-[0.08em] flex-shrink-0',
          statusBadgeClass(event.status),
        )}
      >
        {event.status === 'running' && (
          <Loader2 size={9} className="inline mr-1 animate-spin" />
        )}
        {statusLabel(event.status)}
      </span>
      {event.agent && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={cn('size-1.5 rounded-full', statusDotClass(event.agent.status))} />
          <span className="font-mono text-[10px] text-muted-foreground">{event.agent.name}</span>
        </div>
      )}
    </div>
  )
}

// ─── Kanban ───────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  title: string
  events: EnrichedEvent[]
  selectedId?: string
  onSelect: (e: EnrichedEvent) => void
  accent?: string
}

function KanbanColumn({ title, events, selectedId, onSelect, accent }: KanbanColumnProps) {
  return (
    <div className="flex-shrink-0 w-52 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </span>
        <span className="font-mono text-[9px] bg-secondary text-muted-foreground px-1.5 py-0.5">
          {events.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {events.map(e => (
          <button
            key={e.id}
            onClick={() => onSelect(e)}
            className={cn(
              'text-left bg-background border-hairline p-3 hover:border-foreground/30 transition-all',
              selectedId === e.id ? 'border-foreground shadow-sm' : '',
              e.status === 'failed' ? 'border-l-2 border-l-red-400' : '',
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-[12px] font-medium text-foreground leading-snug flex-1">
                {skillLabel(e.skill_id)}
              </span>
              <span className={cn('size-2 rounded-full flex-shrink-0 mt-0.5', statusDotClass(e.status))} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-muted-foreground truncate">
                {e.agent?.name ?? 'Agente desconhecido'}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground flex-shrink-0">
                {relTime(e.started_at)}
              </span>
            </div>
            {(e.status === 'running' || e.status === 'failed') && (
              <span
                className={cn(
                  'inline-block font-mono text-[9px] px-1.5 py-0.5 mt-2',
                  accent ?? statusBadgeClass(e.status),
                )}
              >
                {e.status === 'running' && '● '}
                {statusLabel(e.status)}
              </span>
            )}
          </button>
        ))}
        {events.length === 0 && (
          <div className="border-hairline border-dashed p-4 text-center">
            <span className="font-mono text-[10px] text-muted-foreground/50">vazio</span>
          </div>
        )}
      </div>
    </div>
  )
}

function KanbanView({
  events,
  selectedId,
  onSelect,
}: {
  events: EnrichedEvent[]
  selectedId?: string
  onSelect: (e: EnrichedEvent) => void
}) {
  const pending   = events.filter(e => e.status === 'pending')
  const running   = events.filter(e => e.status === 'running')
  const completed = events.filter(e => e.status === 'completed' || e.status === 'failed').slice(0, 12)

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="flex gap-5 h-full min-h-0">
        <KanbanColumn
          title="Pendente"
          events={pending}
          selectedId={selectedId}
          onSelect={onSelect}
        />
        <KanbanColumn
          title="Em andamento"
          events={running}
          selectedId={selectedId}
          onSelect={onSelect}
          accent="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
        />
        <KanbanColumn
          title="Concluído"
          events={completed}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
    </div>
  )
}

// ─── ConversationView ─────────────────────────────────────────────────────────

function HitlCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: WikiApproval
  onApprove: () => void
  onReject: () => void
}) {
  const approve = useApproveWrite()
  const reject = useRejectWrite()

  return (
    <div className="border border-amber-300 dark:border-amber-700">
      <div className="bg-amber-50 dark:bg-amber-900/20 px-4 py-2 flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-amber-700 dark:text-amber-400 flex-1">
          Human-in-the-loop · aprovação necessária
        </span>
        <span className="font-mono text-[10px] text-amber-600 dark:text-amber-500">
          {relTime(approval.created_at)}
        </span>
      </div>
      <div className="px-4 py-3 bg-background">
        <p className="text-[13px] text-foreground mb-1">
          <span className="font-medium">{approval.title}</span>
        </p>
        <p className="font-mono text-[10px] text-muted-foreground mb-3">
          {approval.slug} ·{' '}
          {approval.target_wiki === 'strategic' ? 'Wiki Estratégica' : 'Wiki do Agente'}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="font-mono text-[10px] h-7"
            disabled={approve.isPending}
            onClick={onApprove}
          >
            <CheckCircle2 size={10} className="mr-1" />
            Confirmar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-[10px] h-7 border-red-300 text-red-600 hover:bg-red-50"
            disabled={reject.isPending}
            onClick={onReject}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConversationView({
  event,
  allApprovals,
  onNewTask,
}: {
  event: EnrichedEvent | undefined
  allApprovals: WikiApproval[]
  onNewTask: () => void
}) {
  const approve = useApproveWrite()
  const reject = useRejectWrite()
  const execute = useOrchestratorExecute()
  const [msgInput, setMsgInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Approvals for the currently selected agent
  const hitlItems = useMemo(
    () => (event?.agent_id ? allApprovals.filter(a => a.agent_id === event.agent_id) : allApprovals.slice(0, 3)),
    [allApprovals, event?.agent_id],
  )

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [event?.id])

  const handleSend = () => {
    if (!msgInput.trim() || !event?.agent_id) return
    execute.mutate({
      agent_id: event.agent_id,
      skill_id: event.skill_id,
      input: { query: msgInput.trim() },
      activation_mode: 'on_demand',
    })
    setMsgInput('')
  }

  if (!event) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3 text-muted-foreground">
        <Activity size={28} strokeWidth={1} className="opacity-20" />
        <p className="text-sm">Selecione uma execução no Kanban</p>
        <Button size="sm" onClick={onNewTask} className="font-mono text-[10px] h-7 mt-1">
          <Plus size={11} className="mr-1.5" />
          Nova execução
        </Button>
      </div>
    )
  }

  const inputText = extractInputText(event.payload)
  const resultText = extractResultText(event.result)

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        {/* User input message */}
        <div className="flex justify-end">
          <div className="max-w-[70%] bg-background border-hairline px-4 py-3 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
            {inputText}
          </div>
        </div>

        {/* Agent response or streaming */}
        <div className="flex flex-col gap-1.5 max-w-[84%]">
          <div className="flex items-center gap-2">
            <div
              className="size-5 rounded-full flex items-center justify-center text-[9px] font-medium flex-shrink-0"
              style={{ background: 'hsl(var(--secondary))' }}
            >
              <Bot size={11} />
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              {event.agent?.name ?? 'Agente'} · {relTime(event.started_at)}
            </span>
          </div>

          {event.status === 'running' && (
            <div className="bg-background border-hairline px-4 py-3 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-muted-foreground" />
              <span className="font-mono text-[11px] text-muted-foreground">
                Executando {skillLabel(event.skill_id)}…
              </span>
            </div>
          )}

          {event.status === 'pending' && (
            <div className="bg-background border-hairline px-4 py-3">
              <span className="font-mono text-[11px] text-muted-foreground">
                Aguardando execução…
              </span>
            </div>
          )}

          {event.status === 'completed' && resultText && (
            <div className="bg-background border-hairline px-4 py-3 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
              {resultText}
            </div>
          )}

          {event.status === 'failed' && (
            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-mono text-[10px] text-red-600 dark:text-red-400 font-medium uppercase tracking-[0.08em] mb-1">
                  Execução falhou
                </p>
                <p className="font-mono text-[11px] text-red-600 dark:text-red-400">
                  {event.error_code ?? 'Erro desconhecido'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* HITL cards */}
        {hitlItems.map(a => (
          <HitlCard
            key={a.id}
            approval={a}
            onApprove={() => approve.mutate(a.id)}
            onReject={() => reject.mutate({ id: a.id })}
          />
        ))}
      </div>

      {/* Input area */}
      <div className="border-t-hairline bg-background px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="font-mono text-[9px] px-2 py-0.5 bg-secondary text-muted-foreground flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', statusDotClass(event.status))} />
            #{event.id.slice(0, 8)} · {event.agent?.name ?? 'Agente'}
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">
            Mensagens vão para {skillLabel(event.skill_id)}
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="font-mono text-[10px] h-9 flex-shrink-0"
            onClick={onNewTask}
          >
            <Plus size={11} className="mr-1" />
            Nova execução
          </Button>
          <Input
            value={msgInput}
            onChange={e => setMsgInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Continue a conversa..."
            className="font-mono text-[12px] h-9"
            disabled={!event.agent_id}
          />
          <Button
            size="sm"
            className="font-mono text-[10px] h-9 flex-shrink-0"
            onClick={handleSend}
            disabled={!msgInput.trim() || !event.agent_id || execute.isPending}
          >
            <Send size={11} />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── LogStep ─────────────────────────────────────────────────────────────────

interface LogStep {
  id: string
  name: string
  stepStatus: 'done' | 'running' | 'pending' | 'failed'
  latency: string | null
  detail: string
  model: string | null
  tokens: number | null
  cost: number | null
}

function buildSteps(event: EnrichedEvent): LogStep[] {
  const steps: LogStep[] = []
  const isRunning  = event.status === 'running'
  const isDone     = event.status === 'completed'
  const isFailed   = event.status === 'failed'
  const isPending  = event.status === 'pending'

  steps.push({
    id: 'validate',
    name: 'Validação pre-execução',
    stepStatus: isPending ? 'pending' : 'done',
    latency: null,
    detail: `Agente: ${event.agent?.name ?? event.agent_id ?? '—'}\nSkill: ${event.skill_id}\nModo: ${event.activation_mode}\nProfundidade: ${event.call_depth}`,
    model: null,
    tokens: null,
    cost: null,
  })

  steps.push({
    id: 'execute',
    name: skillLabel(event.skill_id),
    stepStatus: isPending ? 'pending' : isRunning ? 'running' : isDone ? 'done' : isFailed ? 'failed' : 'pending',
    latency: latencyMs(event),
    detail: event.payload ? JSON.stringify(event.payload, null, 2) : '(sem payload)',
    model: SKILL_MODELS[event.skill_id] ?? null,
    tokens: event.tokens_used || null,
    cost: parseFloat(event.cost_usd) || null,
  })

  if (isDone) {
    steps.push({
      id: 'record',
      name: 'Registro de resultado',
      stepStatus: 'done',
      latency: null,
      detail: `Tokens: ${event.tokens_used}\nCusto: $${parseFloat(event.cost_usd).toFixed(4)}\nID: ${event.id}`,
      model: null,
      tokens: null,
      cost: null,
    })
  }

  return steps
}

function LogStepRow({ step }: { step: LogStep }) {
  const [open, setOpen] = useState(false)

  const dotClass = {
    done:    'bg-green-500',
    running: 'bg-green-500 animate-pulse',
    pending: 'bg-background border border-border',
    failed:  'bg-red-500',
  }[step.stepStatus]

  return (
    <div className="grid grid-cols-[22px_1fr] relative">
      {/* Connector line */}
      <div className="flex justify-center pt-1.5">
        <div className={cn('size-2 rounded-full flex-shrink-0', dotClass)} />
      </div>
      <div className="pb-4 pr-3">
        <button
          className="flex items-center gap-2 w-full text-left"
          onClick={() => step.detail && setOpen(o => !o)}
          disabled={!step.detail}
        >
          <span className={cn('text-[12px] font-medium flex-1', step.stepStatus === 'pending' ? 'text-muted-foreground' : 'text-foreground')}>
            {step.name}
          </span>
          {step.latency && (
            <span className="font-mono text-[9px] text-muted-foreground flex-shrink-0">
              {step.latency}
            </span>
          )}
          {step.detail && (
            <ChevronRight
              size={11}
              className={cn('flex-shrink-0 opacity-35 transition-transform', open && 'rotate-90')}
            />
          )}
        </button>

        {open && (
          <div className="mt-2 bg-secondary p-2.5">
            <pre className="font-mono text-[10px] text-foreground whitespace-pre-wrap leading-relaxed">
              {step.detail}
            </pre>
            {(step.model || step.tokens !== null || step.cost !== null) && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {step.model && (
                  <span className="font-mono text-[9px] px-1.5 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
                    {step.model}
                  </span>
                )}
                {step.tokens !== null && (
                  <span className="font-mono text-[9px] px-1.5 py-0.5 bg-secondary text-muted-foreground">
                    {step.tokens.toLocaleString()} tok
                  </span>
                )}
                {step.cost !== null && step.cost > 0 && (
                  <span className="font-mono text-[9px] px-1.5 py-0.5 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                    ${step.cost.toFixed(4)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── LogPanel ────────────────────────────────────────────────────────────────

function LogPanel({ event }: { event: EnrichedEvent | undefined }) {
  const steps = useMemo(() => (event ? buildSteps(event) : []), [event])
  const cost = event ? parseFloat(event.cost_usd) : 0

  return (
    <aside className="w-72 border-l-hairline flex-shrink-0 flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="h-12 border-b-hairline flex items-center justify-between px-4 flex-shrink-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Log de execução
        </span>
        {cost > 0 && (
          <span className="font-mono text-[10px] bg-secondary text-foreground px-2 py-0.5">
            ${cost.toFixed(4)}
          </span>
        )}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-3 pt-4">
        {!event ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Clock size={24} strokeWidth={1} className="opacity-20" />
            <p className="font-mono text-[10px] uppercase tracking-[0.1em]">sem seleção</p>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div
              className="absolute left-[10px] top-1.5 bottom-0 w-px bg-border"
              style={{ height: `calc(100% - 8px)` }}
            />
            {steps.map(step => (
              <LogStepRow key={step.id} step={step} />
            ))}
          </div>
        )}
      </div>

      {/* Session context */}
      {event && (
        <div className="border-t-hairline px-4 py-3 flex-shrink-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground mb-2">
            Contexto da sessão
          </div>
          {[
            ['ID', event.id.slice(0, 16) + '…'],
            ['Agente', event.agent?.name ?? '—'],
            ['Modelo', SKILL_MODELS[event.skill_id] ?? '—'],
            ['Tokens', event.tokens_used.toLocaleString()],
            ['Custo', `$${parseFloat(event.cost_usd).toFixed(4)}`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-0.5">
              <span className="font-mono text-[10px] text-muted-foreground">{k}</span>
              <span className="font-mono text-[10px] text-foreground truncate max-w-[130px] text-right">{v}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

// ─── NewExecutionModal ────────────────────────────────────────────────────────

function NewExecutionModal({
  agents,
  onClose,
}: {
  agents: Agent[]
  onClose: () => void
}) {
  const execute = useOrchestratorExecute()
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? '')
  const [selectedSkill, setSelectedSkill] = useState('wiki:query')
  const [inputJson, setInputJson] = useState('{\n  "query": ""\n}')
  const [jsonError, setJsonError] = useState('')

  const selectedAgent = agents.find(a => a.id === selectedAgentId)
  const agentSkills = selectedAgent?.skills.filter(s => s.enabled).map(s => s.skill_name) ?? ALL_SKILLS

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(inputJson) as Record<string, unknown>
      setJsonError('')
    } catch {
      setJsonError('JSON inválido')
      return
    }
    execute.mutate(
      { agent_id: selectedAgentId, skill_id: selectedSkill, input: parsed, activation_mode: 'on_demand' },
      { onSuccess: onClose },
    )
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-background border-hairline w-[480px] max-w-[95vw] shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-hairline">
          <h2 className="text-[14px] font-semibold">Nova execução</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {/* Agent selector */}
          <div>
            <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-2">
              Agente
            </label>
            <div className="grid grid-cols-3 gap-2">
              {agents.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelectedAgentId(a.id)
                    setSelectedSkill('wiki:query')
                  }}
                  className={cn(
                    'text-left p-2.5 border-hairline hover:border-foreground/30 transition-all',
                    selectedAgentId === a.id ? 'border-foreground bg-secondary' : '',
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={cn('size-1.5 rounded-full', statusDotClass(a.status))} />
                    <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.08em]">
                      {a.status}
                    </span>
                  </div>
                  <p className="text-[12px] font-medium text-foreground truncate">{a.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground truncate">{a.role}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Skill selector */}
          <div>
            <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
              Skill
            </label>
            <select
              value={selectedSkill}
              onChange={e => setSelectedSkill(e.target.value)}
              className="w-full font-mono text-[12px] bg-background border-hairline px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {agentSkills.map(s => (
                <option key={s} value={s}>
                  {skillLabel(s)}
                </option>
              ))}
              {agentSkills.length === 0 &&
                ALL_SKILLS.map(s => (
                  <option key={s} value={s}>
                    {skillLabel(s)}
                  </option>
                ))}
            </select>
          </div>

          {/* Input JSON */}
          <div>
            <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
              Input (JSON)
            </label>
            <textarea
              value={inputJson}
              onChange={e => { setInputJson(e.target.value); setJsonError('') }}
              rows={5}
              spellCheck={false}
              className={cn(
                'w-full font-mono text-[12px] bg-background border-hairline p-3 resize-none focus:outline-none focus:ring-1 focus:ring-primary',
                jsonError ? 'border-destructive' : '',
              )}
            />
            {jsonError && (
              <p className="font-mono text-[10px] text-destructive mt-1">{jsonError}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" className="font-mono text-[10px]" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" className="font-mono text-[10px]" disabled={execute.isPending}>
              {execute.isPending ? (
                <>
                  <Loader2 size={11} className="mr-1.5 animate-spin" />
                  Executando…
                </>
              ) : (
                'Executar'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type ViewMode = 'kanban' | 'conversation'

export function OrchestratorPage() {
  const { data: agents = [], isLoading: loadingAgents } = useAgents()
  const { data: events = [], isLoading: loadingEvents } = useAiosEvents({ limit: 50 })
  const { data: approvals = [] } = useWikiApprovals()
  const { data: stats } = useDashboardStats()

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [filterAgentId, setFilterAgentId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  // Enrich events with agent data
  const agentMap = useMemo(
    () => new Map<string, Agent>(agents.map(a => [a.id, a])),
    [agents],
  )

  const enriched: EnrichedEvent[] = useMemo(
    () =>
      events.map(e => ({
        ...e,
        agent: e.agent_id ? agentMap.get(e.agent_id) : undefined,
      })),
    [events, agentMap],
  )

  const filtered = useMemo(
    () => (filterAgentId ? enriched.filter(e => e.agent_id === filterAgentId) : enriched),
    [enriched, filterAgentId],
  )

  const selectedEvent = useMemo(
    () => (selectedEventId ? enriched.find(e => e.id === selectedEventId) : enriched[0]),
    [selectedEventId, enriched],
  )

  function handleSelectEvent(e: EnrichedEvent) {
    setSelectedEventId(e.id)
    setViewMode('conversation')
  }

  const isLoading = loadingAgents || loadingEvents

  return (
    <>
      <div
        className="flex -mx-8 -mb-8 overflow-hidden"
        style={{ height: 'calc(100vh - 88px)' }}
      >
        {/* Left sidebar */}
        <LeftSidebar
          agents={agents}
          costMonth={stats?.cost_usd_month ?? 0}
          pendingHitl={approvals.length}
          selectedAgentId={filterAgentId}
          onSelectAgent={id => { setFilterAgentId(id); setSelectedEventId(null); setViewMode('kanban') }}
        />

        {/* Center */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Task header */}
          <TaskHeader event={selectedEvent} />

          {/* View tabs + new task button */}
          <div className="flex items-center border-b-hairline bg-background flex-shrink-0">
            <div className="flex flex-1">
              {([
                { id: 'kanban' as ViewMode, label: 'Kanban', icon: LayoutGrid },
                { id: 'conversation' as ViewMode, label: 'Conversa', icon: MessageSquare },
              ] as Array<{ id: ViewMode; label: string; icon: LucideIcon }>).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setViewMode(id)}
                  className={cn(
                    'flex items-center gap-1.5 font-mono uppercase tracking-[0.1em] text-[10px] px-4 py-2.5 border-b-2 transition-colors',
                    viewMode === id
                      ? 'border-b-primary text-foreground'
                      : 'border-b-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon size={11} />
                  {label}
                </button>
              ))}
            </div>
            <div className="px-3">
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-[10px] h-7"
                onClick={() => setShowModal(true)}
              >
                <Plus size={11} className="mr-1" />
                Nova execução
              </Button>
            </div>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="flex-1 p-5 flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : viewMode === 'kanban' ? (
            <KanbanView
              events={filtered}
              selectedId={selectedEvent?.id}
              onSelect={handleSelectEvent}
            />
          ) : (
            <ConversationView
              event={selectedEvent}
              allApprovals={approvals}
              onNewTask={() => setShowModal(true)}
            />
          )}
        </div>

        {/* Right log */}
        <LogPanel event={selectedEvent} />
      </div>

      {/* Modal */}
      {showModal && (
        <NewExecutionModal
          agents={agents}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
