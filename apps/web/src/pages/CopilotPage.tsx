import { useState } from 'react'
import { ConversationsSidebar } from '@/components/copilot/ConversationsSidebar'

export function CopilotPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  return (
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      <ConversationsSidebar
        selectedId={selectedConversationId}
        onSelect={setSelectedConversationId}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="h-12 border-b-hairline flex items-center px-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {selectedConversationId ? `#${selectedConversationId.slice(0, 8)}` : 'Selecione uma conversa'}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">ChatView coming in Task 28</p>
        </div>
      </div>

      <aside className="w-[280px] flex-shrink-0 border-l-hairline bg-background">
        <div className="p-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Tool calls
        </div>
      </aside>
    </div>
  )
}
