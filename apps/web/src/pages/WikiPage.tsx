import { useState, useMemo } from 'react'
import {
  BookOpen,
  Search,
  Upload,
  CheckSquare,
  ChevronRight,
  Database,
  Bot,
  type LucideIcon,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAgents } from '@/hooks/useAgents'
import {
  useWikiPages,
  useWikiAgentPages,
  useWikiSearch,
  useWikiIngest,
  useWikiApprovals,
  useApproveWrite,
  useRejectWrite,
} from '@/hooks/useWiki'
import type { WikiPageItem, WikiApproval } from '@/hooks/useWiki'

// ---------- Types ----------

type ScopeType = 'strategic' | 'agent'

interface WikiScope {
  type: ScopeType
  id: string
  label: string
}

type TabId = 'pages' | 'search' | 'ingest' | 'approvals'

// ---------- Helpers ----------

const TYPE_LABELS: Record<string, string> = {
  conceito: 'conceito',
  processo: 'processo',
  decisao: 'decisão',
  politica: 'política',
  referencia: 'referência',
  padrao: 'padrão',
  regulatorio: 'regulatório',
}

const CONFIDENCE_STYLES: Record<string, string> = {
  alta: 'text-green-700 dark:text-green-400 border-green-300 dark:border-green-700',
  media: 'text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700',
  baixa: 'text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700',
  pendente: 'text-muted-foreground border-border',
}

const FILE_TYPES = [
  { value: 'txt', label: 'Texto (.txt)' },
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

// ---------- WikiPage ----------

export function WikiPage() {
  const { data: agents = [] } = useAgents()
  const { data: approvals = [] } = useWikiApprovals()
  const [scope, setScope] = useState<WikiScope>({
    type: 'strategic',
    id: '_system',
    label: 'Wiki Estratégica',
  })
  const [tab, setTab] = useState<TabId>('pages')

  const scopes: WikiScope[] = useMemo(
    () => [
      { type: 'strategic', id: '_system', label: 'Wiki Estratégica' },
      ...agents.map(a => ({ type: 'agent' as ScopeType, id: a.id, label: a.name })),
    ],
    [agents],
  )

  function selectScope(s: WikiScope) {
    setScope(s)
    setTab('pages')
  }

  const pendingCount = approvals.length

  const tabs: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
    { id: 'pages', label: 'Páginas', icon: BookOpen },
    { id: 'search', label: 'Buscar', icon: Search },
    { id: 'ingest', label: 'Ingerir', icon: Upload },
    ...(scope.type === 'strategic'
      ? [{ id: 'approvals' as TabId, label: 'Aprovar', icon: CheckSquare }]
      : []),
  ]

  return (
    <div className="flex gap-0 -mx-6 min-h-[calc(100vh-100px)]">
      {/* Left scope nav */}
      <aside className="w-52 flex-shrink-0 border-r-hairline">
        <div className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground px-4 py-3 border-b-hairline">
          Escopo
        </div>
        <nav className="flex flex-col">
          {scopes.map(s => (
            <button
              key={s.id}
              onClick={() => selectScope(s)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-left border-b-hairline hover:bg-secondary transition-colors',
                scope.id === s.id ? 'bg-secondary' : '',
              )}
            >
              {s.type === 'strategic' ? (
                <Database size={11} className="flex-shrink-0 text-muted-foreground" />
              ) : (
                <Bot size={11} className="flex-shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  'flex-1 truncate text-[11px]',
                  scope.id === s.id ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {s.type === 'strategic' ? '_system' : s.label}
              </span>
              {scope.id === s.id && (
                <ChevronRight size={10} className="flex-shrink-0 text-muted-foreground" />
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Right content */}
      <div className="flex-1 min-w-0 px-6 pt-1">
        {/* Header */}
        <div className="mb-5">
          <div className="font-mono uppercase tracking-[0.15em] text-[9px] text-muted-foreground mb-1">
            ETHRA NEXUS · WIKI ·{' '}
            {scope.type === 'strategic' ? '_SYSTEM' : scope.label.toUpperCase()}
          </div>
          <h1 className="text-xl font-semibold text-foreground tracking-[-0.01em]">
            {scope.type === 'strategic' ? 'Wiki Estratégica' : scope.label}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {scope.type === 'strategic'
              ? 'Conhecimento compartilhado do tenant — acessível por todos os agentes.'
              : 'Conhecimento individual do agente — aprendizado específico.'}
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border-b-hairline mb-5">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'relative flex items-center gap-1.5 font-mono uppercase tracking-[0.1em] text-[10px] px-4 py-2.5 border-b-2 transition-colors',
                tab === id
                  ? 'border-b-primary text-foreground'
                  : 'border-b-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon size={11} />
              {label}
              {id === 'approvals' && pendingCount > 0 && (
                <span className="ml-1 font-mono text-[9px] bg-primary text-primary-foreground px-1 leading-4">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'pages' && <WikiPagesTab scope={scope} />}
        {tab === 'search' && <WikiSearchTab />}
        {tab === 'ingest' && <WikiIngestTab scope={scope} />}
        {tab === 'approvals' && scope.type === 'strategic' && <WikiApprovalsTab />}
      </div>
    </div>
  )
}

// ---------- WikiPagesTab ----------

function WikiPagesTab({ scope }: { scope: WikiScope }) {
  const [filter, setFilter] = useState('')
  const { data: strategic = [], isLoading: loadingStrategic } = useWikiPages()
  const { data: agentPages = [], isLoading: loadingAgent } = useWikiAgentPages(
    scope.type === 'agent' ? scope.id : null,
  )

  const pages = scope.type === 'strategic' ? strategic : agentPages
  const isLoading = scope.type === 'strategic' ? loadingStrategic : loadingAgent

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim()
    if (!q) return pages
    return pages.filter(
      p =>
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q),
    )
  }, [pages, filter])

  const stats = useMemo(
    () => ({
      total: pages.length,
      active: pages.filter(p => p.status === 'ativo').length,
      pending: pages.filter(p => p.status !== 'ativo').length,
    }),
    [pages],
  )

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center">
        Nenhuma página nesta wiki. Use a aba Ingerir para adicionar conteúdo.
      </p>
    )
  }

  return (
    <div>
      {/* Stats row */}
      <div className="flex gap-6 mb-5 pb-4 border-b-hairline">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground mb-0.5">
            Total
          </p>
          <p className="font-mono text-xl font-semibold tabular-nums">{stats.total}</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground mb-0.5">
            Ativas
          </p>
          <p className="font-mono text-xl font-semibold tabular-nums text-green-600 dark:text-green-400">
            {stats.active}
          </p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground mb-0.5">
            Pendentes
          </p>
          <p className="font-mono text-xl font-semibold tabular-nums text-yellow-600 dark:text-yellow-400">
            {stats.pending}
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-4">
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filtrar por título, slug ou tipo..."
          className="max-w-sm font-mono"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Nenhuma página encontrada para &ldquo;{filter}&rdquo;.
        </p>
      ) : (
        <div className="border-hairline">
          {filtered.map(page => (
            <PageCard key={page.id} page={page} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- PageCard ----------

function PageCard({ page }: { page: WikiPageItem }) {
  const confidenceStyle = CONFIDENCE_STYLES[page.confidence] ?? CONFIDENCE_STYLES['pendente']

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b-hairline last:border-b-0 hover:bg-secondary transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{page.title}</p>
        <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{page.slug}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="font-mono text-[9px] px-1.5 py-0.5 border-hairline text-muted-foreground uppercase tracking-[0.08em]">
          {TYPE_LABELS[page.type] ?? page.type}
        </span>
        <span
          className={cn(
            'font-mono text-[9px] px-1.5 py-0.5 border',
            confidenceStyle,
          )}
        >
          {page.confidence}
        </span>
        {page.author_type === 'agent' && (
          <span className="font-mono text-[9px] px-1.5 py-0.5 border-hairline text-muted-foreground">
            agente
          </span>
        )}
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums w-16 text-right">
          {formatDate(page.updated_at)}
        </span>
      </div>
    </div>
  )
}

// ---------- WikiSearchTab ----------

function WikiSearchTab() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const { data: results = [], isFetching } = useWikiSearch(query)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(input.trim())
  }

  return (
    <div className="max-w-xl">
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Busca semântica na wiki estratégica..."
          className="font-mono"
        />
        <Button type="submit" disabled={input.trim().length < 3}>
          <Search size={14} className="mr-1.5" />
          Buscar
        </Button>
      </form>

      {isFetching && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {!isFetching && query && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhum resultado para &ldquo;{query}&rdquo;.
        </p>
      )}

      {!isFetching && results.length > 0 && (
        <div className="border-hairline">
          {results.map(r => (
            <div
              key={r.id}
              className="flex items-start justify-between gap-3 px-4 py-3 border-b-hairline last:border-b-0 hover:bg-secondary transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{r.title}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {r.slug} · {r.type}
                </p>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                {(r.similarity * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- WikiIngestTab ----------

function WikiIngestTab({ scope }: { scope: WikiScope }) {
  const [sourceName, setSourceName] = useState('')
  const [content, setContent] = useState('')
  const [fileType, setFileType] = useState('txt')
  const ingest = useWikiIngest()

  const handleIngest = (e: React.FormEvent) => {
    e.preventDefault()
    if (!sourceName.trim() || content.trim().length < 50) return
    const content_base64 = btoa(unescape(encodeURIComponent(content)))
    ingest.mutate({ content_base64, file_type: fileType, source_name: sourceName.trim() })
  }

  return (
    <form onSubmit={handleIngest} className="max-w-xl flex flex-col gap-4">
      {/* Destination note */}
      <div className="bg-secondary border-hairline px-4 py-3">
        <p className="font-mono text-[10px] text-muted-foreground">
          Destino:{' '}
          <span className="text-foreground font-medium">
            Wiki Estratégica (_system)
          </span>
          {scope.type === 'agent' && (
            <span className="ml-2 text-muted-foreground">
              — ingestão sempre vai para a wiki compartilhada
            </span>
          )}
        </p>
      </div>

      <div>
        <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
          Nome da fonte
        </label>
        <Input
          value={sourceName}
          onChange={e => setSourceName(e.target.value)}
          placeholder="Ex: Política Comercial 2026"
          className="font-mono"
          required
        />
      </div>

      <div>
        <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
          Tipo de conteúdo
        </label>
        <select
          value={fileType}
          onChange={e => setFileType(e.target.value)}
          className="w-full font-mono text-[12px] bg-background border-hairline px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {FILE_TYPES.map(ft => (
            <option key={ft.value} value={ft.value}>
              {ft.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="font-mono text-[10px] font-medium text-muted-foreground uppercase tracking-[0.12em] block mb-1.5">
          Conteúdo (mín. 50 caracteres)
        </label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={12}
          className="w-full font-mono text-[12px] bg-background border-hairline p-3 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Cole aqui o texto bruto que será processado pelo LLM e transformado em páginas da wiki..."
          required
        />
        <p className="font-mono text-[9px] text-muted-foreground mt-1 text-right">
          {content.length} caracteres
        </p>
      </div>

      {ingest.data && (
        <div className="bg-secondary p-3 border-hairline">
          <p className="font-mono text-[10px] text-foreground font-medium mb-1">
            Resultado da ingestão
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Extraídas: {ingest.data.pages_extracted} · Salvas: {ingest.data.pages_persisted} ·
            Com embedding: {ingest.data.pages_embedded}
          </p>
        </div>
      )}

      <div>
        <Button
          type="submit"
          disabled={ingest.isPending || !sourceName.trim() || content.trim().length < 50}
        >
          {ingest.isPending ? 'Processando…' : 'Ingerir conhecimento'}
        </Button>
      </div>
    </form>
  )
}

// ---------- WikiApprovalsTab ----------

function WikiApprovalsTab() {
  const { data: approvals = [], isLoading } = useWikiApprovals()
  const approve = useApproveWrite()
  const reject = useRejectWrite()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  if (approvals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center">
        Nenhuma proposta pendente de revisão.
      </p>
    )
  }

  return (
    <div className="border-hairline max-w-2xl">
      {approvals.map((a: WikiApproval) => (
        <div key={a.id} className="border-b-hairline last:border-b-0">
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{a.title}</p>
              <p className="font-mono text-[10px] text-muted-foreground mt-0.5">
                {a.slug} ·{' '}
                {a.target_wiki === 'strategic' ? 'Wiki Estratégica' : 'Wiki do Agente'} ·{' '}
                {formatDate(a.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground px-2 py-1 border-hairline transition-colors"
              >
                {expanded === a.id ? 'Fechar' : 'Ver'}
              </button>
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-[10px] h-7"
                disabled={reject.isPending}
                onClick={() => reject.mutate({ id: a.id })}
              >
                Rejeitar
              </Button>
              <Button
                size="sm"
                className="font-mono text-[10px] h-7"
                disabled={approve.isPending}
                onClick={() => approve.mutate(a.id)}
              >
                Aprovar
              </Button>
            </div>
          </div>
          {expanded === a.id && (
            <div className="px-4 pb-3">
              <pre className="font-mono text-[10px] text-foreground bg-secondary p-3 border-hairline whitespace-pre-wrap overflow-auto max-h-48 leading-relaxed">
                {a.content}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
