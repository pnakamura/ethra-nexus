import { useState } from 'react'
import { ConversationsSidebar } from '@/components/copilot/ConversationsSidebar'
import { ChatView } from '@/components/copilot/ChatView'
import { ToolCallsLog } from '@/components/copilot/ToolCallsLog'
import { useCopilotConversation, useSendCopilotMessage } from '@/hooks/useCopilot'

export function CopilotPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data } = useCopilotConversation(selectedId)
  const stream = useSendCopilotMessage(selectedId)

  return (
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      <ConversationsSidebar selectedId={selectedId} onSelect={setSelectedId} />

      {selectedId ? (
        <ChatView conversationId={selectedId} />
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">Selecione uma conversa ou crie uma nova.</p>
        </div>
      )}

      <ToolCallsLog
        messages={data?.messages ?? []}
        streamingTools={stream.currentToolCalls}
      />
    </div>
  )
}
