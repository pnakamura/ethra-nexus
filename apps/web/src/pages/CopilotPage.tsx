import { useState } from 'react'
import { ConversationsSidebar } from '@/components/copilot/ConversationsSidebar'
import { ChatView } from '@/components/copilot/ChatView'

export function CopilotPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

      <aside className="w-[280px] flex-shrink-0 border-l-hairline bg-background">
        <div className="p-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Tool calls
        </div>
        <p className="px-3 text-[11px] text-muted-foreground">Coming in Task 30</p>
      </aside>
    </div>
  )
}
