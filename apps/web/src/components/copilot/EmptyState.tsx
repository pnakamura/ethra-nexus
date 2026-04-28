import { Sparkles } from 'lucide-react'
import { useCreateCopilotConversation } from '@/hooks/useCopilot'
import { streamCopilotMessage } from '@/lib/copilot-stream'
import { STORAGE_KEY } from '@/contexts/AuthContext'

const STARTER_PROMPTS = [
  'Quais agentes estão ativos?',
  'Mostre as últimas execuções',
  'Quanto gastei esse mês?',
  'Tem coisa pra aprovar?',
]

interface Props {
  onSelectConversation: (id: string) => void
}

export function EmptyState({ onSelectConversation }: Props) {
  const create = useCreateCopilotConversation()

  async function handleChip(prompt: string) {
    const conv = await create.mutateAsync()
    onSelectConversation(conv.id)
    // Send via the streaming hook bound to the new conversation.
    // Using a microtask to allow the parent to update selected state.
    setTimeout(() => {
      const sender = createOneShotSender(conv.id)
      sender.send(prompt)
    }, 50)
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
      <Sparkles size={32} strokeWidth={1.25} className="text-muted-foreground opacity-40" />
      <div className="text-center">
        <h2 className="text-base font-semibold text-foreground mb-1">AIOS Master pronto</h2>
        <p className="text-[13px] text-muted-foreground max-w-md">
          Pergunte sobre seus agentes, execuções, custos, wiki ou aprovações pendentes.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-md">
        {STARTER_PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => handleChip(p)}
            disabled={create.isPending}
            className="text-left px-4 py-2.5 border-hairline hover:bg-secondary transition-colors text-[13px] disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

// Minimal one-shot sender that doesn't need a React render cycle to be bound.
function createOneShotSender(conversationId: string) {
  return {
    send: async (content: string) => {
      try {
        await streamCopilotMessage(
          conversationId,
          content,
          () => undefined,
          new AbortController().signal,
          () => localStorage.getItem(STORAGE_KEY),
        )
      } catch {
        /* ignored — list refetch will surface result */
      }
    },
  }
}
