import { useState, useEffect } from 'react'
import { ConversationsSidebar } from '@/components/copilot/ConversationsSidebar'
import { ChatView } from '@/components/copilot/ChatView'
import { ToolCallsLog } from '@/components/copilot/ToolCallsLog'
import { EmptyState } from '@/components/copilot/EmptyState'
import { HardLimitBanner } from '@/components/copilot/HardLimitBanner'
import { useCopilotConversation, useSendCopilotMessage, useCopilotHealth } from '@/hooks/useCopilot'

export function CopilotPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const { data } = useCopilotConversation(selectedId)
  const stream = useSendCopilotMessage(selectedId)
  const { data: health } = useCopilotHealth()

  // Auto-send a queued prompt once selectedId is bound and the streaming
  // hook has re-initialized for the new conversation.
  useEffect(() => {
    if (selectedId && pendingPrompt) {
      const p = pendingPrompt
      setPendingPrompt(null)
      stream.send(p)
    }
  }, [selectedId, pendingPrompt, stream])

  function handleSelectAndPrompt(id: string, prompt: string) {
    setSelectedId(id)
    setPendingPrompt(prompt)
  }

  return (
    <>
      <HardLimitBanner alerts={health?.banner_alerts ?? []} />
      <div
        className="flex -mx-8 -mb-8 overflow-hidden"
        style={{ height: 'calc(100vh - 88px)' }}
      >
        <ConversationsSidebar selectedId={selectedId} onSelect={setSelectedId} />

        {selectedId ? (
          <ChatView conversationId={selectedId} stream={stream} />
        ) : (
          <EmptyState onSelectAndPrompt={handleSelectAndPrompt} />
        )}

        <ToolCallsLog
          messages={data?.messages ?? []}
          streamingTools={stream.currentToolCalls}
        />
      </div>
    </>
  )
}
