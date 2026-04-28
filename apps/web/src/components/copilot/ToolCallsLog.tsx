import { useState } from 'react'
import { Clock, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CopilotMessage } from '@/hooks/useCopilot'

interface ToolCallView {
  id: string  // tool_use_id
  name: string
  input: Record<string, unknown>
  result: unknown  // from the next user message's tool_result
  status: 'completed' | 'error'
  durationMs: number | null
}

interface Props {
  messages: CopilotMessage[]
  streamingTools?: Array<{ tool_use_id: string; tool_name: string; status: 'running' | 'completed' | 'error'; duration_ms?: number }>
}

function extractToolCalls(messages: CopilotMessage[]): ToolCallView[] {
  const result: ToolCallView[] = []
  const resultMap = new Map<string, { content: string; isError: boolean }>()
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const block of m.content) {
      if (block.type === 'tool_result') {
        const tu = block as { tool_use_id: string; content: string; is_error?: boolean }
        resultMap.set(tu.tool_use_id, { content: tu.content, isError: tu.is_error ?? false })
      }
    }
  }

  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const block of m.content) {
      if (block.type !== 'tool_use') continue
      const tu = block as { id: string; name: string; input?: Record<string, unknown> }
      const r = resultMap.get(tu.id)
      let parsedResult: unknown = r?.content ?? null
      try { if (r?.content) parsedResult = JSON.parse(r.content.replace(/^<tool_output[^>]*>\n?|\n?<\/tool_output>$/g, '')) } catch { /* keep as string */ }
      result.push({
        id: tu.id,
        name: tu.name,
        input: tu.input ?? {},
        result: parsedResult,
        status: r?.isError ? 'error' : 'completed',
        durationMs: null,
      })
    }
  }
  return result
}

function ToolRow({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b-hairline">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-secondary text-left"
      >
        <span className={cn(
          'size-1.5 rounded-full mt-1.5 flex-shrink-0',
          call.status === 'error' ? 'bg-red-500' : 'bg-green-500',
        )} />
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] text-foreground truncate">{call.name}</p>
          {call.durationMs !== null && (
            <p className="font-mono text-[9px] text-muted-foreground">{call.durationMs}ms</p>
          )}
        </div>
        <ChevronRight size={11} className={cn('mt-1 opacity-40 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="px-3 pb-3 bg-secondary">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground mt-1.5 mb-1">input</p>
          <pre className="font-mono text-[10px] whitespace-pre-wrap break-all">{JSON.stringify(call.input, null, 2)}</pre>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground mt-2 mb-1">result</p>
          <pre className="font-mono text-[10px] whitespace-pre-wrap break-all max-h-48 overflow-auto">
            {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export function ToolCallsLog({ messages, streamingTools = [] }: Props) {
  const calls = extractToolCalls(messages)

  return (
    <aside className="w-[280px] flex-shrink-0 border-l-hairline bg-background flex flex-col overflow-hidden">
      <div className="h-12 border-b-hairline flex items-center px-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground flex-shrink-0">
        Tool calls
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-minimal">
        {calls.length === 0 && streamingTools.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Clock size={20} strokeWidth={1} className="opacity-20" />
            <p className="font-mono text-[10px] uppercase tracking-[0.1em]">sem chamadas</p>
          </div>
        )}
        {streamingTools.map(t => (
          <div key={t.tool_use_id} className="border-b-hairline px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className={cn('size-1.5 rounded-full mt-1.5 flex-shrink-0', t.status === 'running' ? 'bg-green-500 animate-pulse' : t.status === 'error' ? 'bg-red-500' : 'bg-green-500')} />
              <p className="font-mono text-[11px] text-foreground truncate flex-1">{t.tool_name}</p>
              {t.duration_ms !== undefined && <span className="font-mono text-[9px] text-muted-foreground">{t.duration_ms}ms</span>}
            </div>
          </div>
        ))}
        {calls.map(c => <ToolRow key={c.id} call={c} />)}
      </div>
    </aside>
  )
}
