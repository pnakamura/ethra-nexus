import { useState } from 'react'
import { BookOpen, Search, Upload } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useWikiIndex, useWikiSearch, useWikiIngest } from '@/hooks/useWiki'

const TABS = [
  { id: 'index',  label: 'Índice',  icon: BookOpen },
  { id: 'search', label: 'Buscar',  icon: Search },
  { id: 'ingest', label: 'Ingerir', icon: Upload },
] as const
type TabId = typeof TABS[number]['id']

export function WikiPage() {
  const [tab, setTab] = useState<TabId>('index')

  return (
    <div>
      {/* Page header */}
      <div className="mb-7">
        <div className="font-mono uppercase tracking-[0.15em] text-[10px] text-muted-foreground mb-1">
          ETHRA NEXUS · WIKI
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-[-0.01em]">
          Wiki
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestão de conhecimento estratégico do tenant.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b-hairline mb-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'flex items-center gap-2 font-mono uppercase tracking-[0.1em] text-[10px] px-5 py-3 border-b-2 transition-colors',
              tab === id
                ? 'border-b-primary text-foreground'
                : 'border-b-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'index'  && <WikiIndexTab />}
      {tab === 'search' && <WikiSearchTab />}
      {tab === 'ingest' && <WikiIngestTab />}
    </div>
  )
}

function WikiIndexTab() {
  const { data: markdown, isLoading } = useWikiIndex()

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    )
  }

  if (!markdown) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Nenhuma página na wiki ainda. Use a aba Ingerir para adicionar conteúdo.
      </p>
    )
  }

  return (
    <pre className="font-mono text-[11px] text-foreground leading-relaxed whitespace-pre-wrap bg-secondary p-5 border-hairline overflow-auto max-h-[60vh]">
      {markdown}
    </pre>
  )
}

function WikiSearchTab() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const { data: results = [], isLoading, isFetching } = useWikiSearch(query)

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
          placeholder="Busca semântica (mín. 3 caracteres)..."
          className="font-mono"
        />
        <Button type="submit" disabled={input.trim().length < 3}>
          <Search size={14} className="mr-1.5" /> Buscar
        </Button>
      </form>

      {isFetching && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      )}

      {!isFetching && query && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Nenhum resultado para "{query}".
        </p>
      )}

      {!isFetching && results.length > 0 && (
        <div className="flex flex-col border-hairline">
          {results.map(r => (
            <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3 border-b-hairline last:border-b-0 hover:bg-secondary transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{r.title}</p>
                <p className="font-mono text-[10px] text-muted-foreground">{r.slug} · {r.type}</p>
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

function WikiIngestTab() {
  const [sourceName, setSourceName] = useState('')
  const [content, setContent] = useState('')
  const ingest = useWikiIngest()

  const handleIngest = (e: React.FormEvent) => {
    e.preventDefault()
    if (!sourceName.trim() || content.trim().length < 50) return
    const content_base64 = btoa(unescape(encodeURIComponent(content)))
    ingest.mutate({ content_base64, file_type: 'txt', source_name: sourceName.trim() })
  }

  return (
    <form onSubmit={handleIngest} className="max-w-xl flex flex-col gap-4">
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
          <p className="font-mono text-[10px] text-foreground font-medium mb-1">Resultado da ingestão</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Extraídas: {ingest.data.pages_extracted} · Salvas: {ingest.data.pages_persisted} · Com embedding: {ingest.data.pages_embedded}
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
