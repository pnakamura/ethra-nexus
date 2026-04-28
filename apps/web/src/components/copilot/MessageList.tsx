import { useEffect, useRef } from 'react'
import type { CopilotMessage } from '@/hooks/useCopilot'
import { UserBubble } from './UserBubble'
import { AssistantBubble } from './AssistantBubble'

interface Props {
  messages: CopilotMessage[]
  streamingText?: string
  streamingToolStatuses?: Record<string, 'running' | 'completed' | 'error'>
  streamingToolDurations?: Record<string, number>
  isStreaming?: boolean
  onToolClick?: (toolUseId: string) => void
}

function userText(content: CopilotMessage['content']): string {
  const text = content.find(b => b.type === 'text') as { type: string; text?: string } | undefined
  return text?.text ?? ''
}

function isToolResultMsg(msg: CopilotMessage): boolean {
  return msg.role === 'user' && msg.content.some(b => b.type === 'tool_result')
}

export function MessageList({
  messages,
  streamingText = '',
  streamingToolStatuses = {},
  streamingToolDurations = {},
  isStreaming = false,
  onToolClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, streamingText])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 scrollbar-minimal">
      {messages.map(msg => {
        // Hide synthetic tool_result user messages
        if (isToolResultMsg(msg)) return null

        if (msg.role === 'user') {
          return <UserBubble key={msg.id} text={userText(msg.content)} />
        }

        return (
          <AssistantBubble
            key={msg.id}
            content={msg.content}
            model={msg.model}
            costUsd={msg.cost_usd}
            errorCode={msg.error_code}
            onToolClick={onToolClick}
          />
        )
      })}

      {isStreaming && (
        <AssistantBubble
          content={streamingText ? [{ type: 'text', text: streamingText }] : []}
          isStreaming
          toolDurations={streamingToolDurations}
          toolStatuses={streamingToolStatuses}
          onToolClick={onToolClick}
        />
      )}
    </div>
  )
}
