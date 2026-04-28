import { eq, asc } from 'drizzle-orm'
import { getDb, copilotConversations, copilotMessages } from '@ethra-nexus/db'
import { getAnthropicClient } from './anthropic-client'

const TITLE_MODEL = 'claude-haiku-4-5-20251001'
const TITLE_SYSTEM = 'Resuma esta conversa em 4 a 6 palavras em português, sem aspas, sem pontuação final. Retorne apenas o título.'

interface MessageRow {
  role: string
  content: unknown
}

function blocksToText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as Array<{ type: string; text?: string }>)
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text)
    .join(' ')
    .slice(0, 500)
}

export async function generateAutoTitle(conversationId: string): Promise<void> {
  try {
    const db = getDb()

    // Skip if already titled
    const convRows = await db.select({ id: copilotConversations.id, title: copilotConversations.title })
      .from(copilotConversations)
      .where(eq(copilotConversations.id, conversationId))
      .limit(1)
    const conv = convRows[0]
    if (!conv || conv.title) return

    // Get first 4 messages (typically: user, assistant, [tool_result, assistant])
    const msgs = await db.select({ role: copilotMessages.role, content: copilotMessages.content })
      .from(copilotMessages)
      .where(eq(copilotMessages.conversation_id, conversationId))
      .orderBy(asc(copilotMessages.created_at))
      .limit(4)

    const messages = (msgs as MessageRow[])
      .map(m => ({ role: m.role as 'user' | 'assistant', content: blocksToText(m.content) }))
      .filter(m => m.content.length > 0)

    if (messages.length === 0) return

    const anth = getAnthropicClient()
    const resp = await anth.messages.create({
      model: TITLE_MODEL,
      max_tokens: 30,
      system: TITLE_SYSTEM,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })

    const titleBlock = (resp.content as Array<{ type: string; text?: string }>).find(b => b.type === 'text')
    const title = titleBlock?.text?.trim().replace(/^["']|["']$/g, '').slice(0, 80)
    if (!title) return

    await db.update(copilotConversations)
      .set({ title, updated_at: new Date() })
      .where(eq(copilotConversations.id, conversationId))
  } catch {
    // Fire-and-forget: never propagate errors
  }
}
