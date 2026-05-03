import type React from 'react'
import { useCopilotConversation, type useSendCopilotMessage } from '@/hooks/useCopilot'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageList } from './MessageList'
import { MessageInput } from './MessageInput'

interface Props {
  conversationId: string
  stream: ReturnType<typeof useSendCopilotMessage>
  onToolClick?: (toolUseId: string) => void
}

function onDrop(e: React.DragEvent<HTMLDivElement>) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  const fileInput = document.querySelector<HTMLInputElement>('input[aria-label="anexar arquivo"]')
  if (!fileInput) return
  const dt = new DataTransfer()
  for (const f of Array.from(files)) dt.items.add(f)
  fileInput.files = dt.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
}

function onDragOver(e: React.DragEvent<HTMLDivElement>) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}

export function ChatView({ conversationId, stream, onToolClick }: Props) {
  const { data, isLoading } = useCopilotConversation(conversationId)

  if (isLoading) {
    return <div className="flex-1 p-5 flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
  }
  if (!data) return null

  const toolStatuses: Record<string, 'running' | 'completed' | 'error'> = {}
  const toolDurations: Record<string, number> = {}
  for (const t of stream.currentToolCalls) {
    toolStatuses[t.tool_use_id] = t.status === 'running' ? 'running' : t.status
    if (t.duration_ms !== undefined) toolDurations[t.tool_use_id] = t.duration_ms
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden" onDrop={onDrop} onDragOver={onDragOver}>
      <div className="h-12 border-b-hairline flex items-center justify-between px-5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-muted-foreground">#{data.conversation.id.slice(0, 8)}</span>
          <span className="text-[13px] font-medium text-foreground truncate">
            {data.conversation.title ?? 'sem título'}
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
          <span>{data.conversation.message_count} msg</span>
          <span>${Number(data.conversation.total_cost_usd).toFixed(4)}</span>
        </div>
      </div>

      <MessageList
        messages={data.messages}
        streamingText={stream.currentText}
        streamingToolStatuses={toolStatuses}
        streamingToolDurations={toolDurations}
        isStreaming={stream.isStreaming}
        onToolClick={onToolClick}
      />

      <MessageInput
        onSend={(content, _attachments) => stream.send(content)}
        disabled={stream.isStreaming}
      />
    </div>
  )
}
