import type { ReactNode } from 'react'
import { Bot, Loader2, AlertTriangle } from 'lucide-react'
import { ToolUseInlineMarker } from './ToolUseInlineMarker'

// Minimal markdown linkifier: [text](https://...) → <a>, plus bare https?://... → <a>.
// Full markdown rendering deferred — this is the smallest viable fix for clickable
// dashboard links from data:render (Spec #4).
function linkifyText(text: string): ReactNode[] {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const linkText = match[1] ?? match[3]!
    const href = match[2] ?? match[3]!
    parts.push(
      <a
        key={`lnk-${key++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-primary hover:opacity-80"
      >
        {linkText}
      </a>,
    )
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: string; [k: string]: unknown }

interface Props {
  content: ContentBlock[]
  model?: string | null
  costUsd?: string
  errorCode?: string | null
  onToolClick?: (toolUseId: string) => void
  toolDurations?: Record<string, number>
  toolStatuses?: Record<string, 'running' | 'completed' | 'error'>
  isStreaming?: boolean
}

export function AssistantBubble({
  content, model, costUsd, errorCode,
  onToolClick, toolDurations = {}, toolStatuses = {}, isStreaming = false,
}: Props) {
  if (errorCode) {
    return (
      <div className="flex flex-col gap-1.5 max-w-[84%]">
        <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-mono text-[10px] text-red-600 dark:text-red-400 uppercase tracking-[0.08em] mb-1">
              {errorCode}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 max-w-[84%]">
      <div className="flex items-center gap-2">
        <div
          className="size-5 rounded-full flex items-center justify-center text-[9px] font-medium flex-shrink-0"
          style={{ background: 'hsl(var(--secondary))' }}
        >
          <Bot size={11} />
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          AIOS Master {model && `· ${model}`}
        </span>
        {costUsd && Number(costUsd) > 0 && (
          <span className="font-mono text-[9px] text-muted-foreground">${Number(costUsd).toFixed(4)}</span>
        )}
        {isStreaming && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
      </div>

      <div className="bg-background border-hairline px-4 py-3 text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
        {content.map((block, i) => {
          if (block.type === 'text') {
            return <span key={i}>{linkifyText((block as { text: string }).text)}</span>
          }
          if (block.type === 'tool_use') {
            const tu = block as { id: string; name: string }
            return (
              <ToolUseInlineMarker
                key={tu.id}
                toolName={tu.name}
                durationMs={toolDurations[tu.id]}
                status={toolStatuses[tu.id] ?? 'completed'}
                onClick={() => onToolClick?.(tu.id)}
              />
            )
          }
          return null
        })}
        {isStreaming && content.length === 0 && (
          <span className="text-muted-foreground italic">pensando…</span>
        )}
      </div>
    </div>
  )
}
