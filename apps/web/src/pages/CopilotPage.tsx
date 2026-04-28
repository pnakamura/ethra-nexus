import { useState } from 'react'

export function CopilotPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  return (
    <div
      className="flex -mx-8 -mb-8 overflow-hidden"
      style={{ height: 'calc(100vh - 88px)' }}
    >
      {/* Left: ConversationsSidebar (Task 27) */}
      <aside className="w-[220px] flex-shrink-0 border-r-hairline bg-background">
        <div className="p-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          AIOS Master
        </div>
        <p className="px-3 text-[12px] text-muted-foreground">Sidebar coming in Task 27</p>
      </aside>

      {/* Center: ChatView (Task 28) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="h-12 border-b-hairline flex items-center px-5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {selectedConversationId ? `#${selectedConversationId.slice(0, 8)}` : 'Selecione uma conversa'}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">CopilotPage shell — components arrive in Tasks 28-31</p>
        </div>
      </div>

      {/* Right: ToolCallsLog (Task 30) */}
      <aside className="w-[280px] flex-shrink-0 border-l-hairline bg-background">
        <div className="p-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Tool calls
        </div>
      </aside>

      {/* avoid unused warning until wired up */}
      <button hidden onClick={() => setSelectedConversationId('placeholder')} />
    </div>
  )
}
