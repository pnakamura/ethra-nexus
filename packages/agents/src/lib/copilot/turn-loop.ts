import { eq, asc, sql } from 'drizzle-orm'
import {
  getDb, copilotConversations, copilotMessages, copilotToolCalls,
} from '@ethra-nexus/db'
import { getAnthropicClient } from './anthropic-client'
import { allCopilotTools, findToolByName } from './tools'
import { executeToolCall, getToolsForAnthropic, type ToolContext } from './tool-registry'
import { createAgentsDb } from '../db/db-agents'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4000
const ESTIMATED_COST_PER_TURN = 0.05  // pre-check estimate

// Anthropic SDK message blocks (subset we use)
type TextBlock = { type: 'text'; text: string }
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export interface SseWriter {
  write: (event: { type: string; [k: string]: unknown }) => void
}

export interface ExecuteCopilotTurnParams {
  conversation_id: string
  tenant_id: string
  user_id: string
  user_role: 'admin' | 'member'
  aios_master_agent_id: string
  content: string
  system_prompt: string
  sse: SseWriter
  abortSignal: AbortSignal
}

export interface TurnResult {
  total_tokens: number
  total_cost_usd: number
  tool_call_count: number
  stop_reason: string
}

export async function executeCopilotTurn(p: ExecuteCopilotTurnParams): Promise<TurnResult> {
  const db = getDb()
  const anth = getAnthropicClient()
  const agentsDb = createAgentsDb()
  const month = new Date().toISOString().slice(0, 7)

  // 0. Budget pre-check (audit fix K1)
  const check = await agentsDb.canExecute(p.aios_master_agent_id, month, ESTIMATED_COST_PER_TURN)
  if (!check.allowed) {
    p.sse.write({ type: 'error', code: 'BUDGET_EXCEEDED', message: check.reason ?? 'Budget exceeded' })
    return { total_tokens: 0, total_cost_usd: 0, tool_call_count: 0, stop_reason: 'budget_exceeded' }
  }

  // 1. Insert user message
  const userMsgRows = await db.insert(copilotMessages).values({
    conversation_id: p.conversation_id,
    tenant_id: p.tenant_id,
    role: 'user',
    content: [{ type: 'text', text: p.content }],
  }).returning({ id: copilotMessages.id })
  const userMessageId = userMsgRows[0]!.id
  p.sse.write({ type: 'turn_start', user_message_id: userMessageId })

  // 2. Load full history
  const historyRows = await db.select({
    role: copilotMessages.role, content: copilotMessages.content,
  })
    .from(copilotMessages)
    .where(eq(copilotMessages.conversation_id, p.conversation_id))
    .orderBy(asc(copilotMessages.created_at))

  const history = historyRows.map(r => ({
    role: r.role as 'user' | 'assistant',
    content: r.content as ContentBlock[],
  }))

  // 3. Call Anthropic (single iteration; tool loop comes in Task 18)
  const ctx: ToolContext = { tenant_id: p.tenant_id, user_id: p.user_id, user_role: p.user_role }
  let totalTokensIn = 0
  let totalTokensOut = 0
  let totalCost = 0
  const toolCallCount = 0
  let lastStopReason = 'end_turn'

  const stream = await anth.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: p.system_prompt,
    tools: getToolsForAnthropic(allCopilotTools),
    messages: history,
    stream: true,
  }, { signal: p.abortSignal })

  const blocks: ContentBlock[] = []
  let currentText = ''

  for await (const event of stream as AsyncIterable<{ type: string; [k: string]: unknown }>) {
    if (event.type === 'content_block_start') {
      const cb = event['content_block'] as { type: string; id?: string; name?: string }
      if (cb.type === 'text') {
        currentText = ''
      } else if (cb.type === 'tool_use') {
        blocks.push({ type: 'tool_use', id: cb.id ?? '', name: cb.name ?? '', input: {} })
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event['delta'] as { type: string; text?: string; partial_json?: string }
      if (delta.type === 'text_delta' && delta.text) {
        currentText += delta.text
        p.sse.write({ type: 'text_delta', delta: delta.text })
      }
    } else if (event.type === 'content_block_stop') {
      if (currentText) {
        blocks.push({ type: 'text', text: currentText })
        currentText = ''
      }
    } else if (event.type === 'message_delta') {
      const md = event['delta'] as { stop_reason?: string }
      const usage = event['usage'] as { input_tokens?: number; output_tokens?: number }
      if (md.stop_reason) lastStopReason = md.stop_reason
      if (usage) {
        totalTokensIn += usage.input_tokens ?? 0
        totalTokensOut += usage.output_tokens ?? 0
      }
    }
  }

  // Estimate cost (Sonnet 4.6 rates: $3/M input, $15/M output)
  const messageCost = (totalTokensIn / 1_000_000) * 3 + (totalTokensOut / 1_000_000) * 15
  totalCost += messageCost

  // 4. Persist assistant message
  const assistantRows = await db.insert(copilotMessages).values({
    conversation_id: p.conversation_id,
    tenant_id: p.tenant_id,
    role: 'assistant',
    content: blocks,
    model: MODEL,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: messageCost.toFixed(6),
    stop_reason: lastStopReason,
  }).returning({ id: copilotMessages.id })
  const assistantMessageId = assistantRows[0]!.id

  p.sse.write({
    type: 'assistant_message_complete',
    message_id: assistantMessageId,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: messageCost,
    stop_reason: lastStopReason,
  })

  // 4b. Budget integration post-message (audit fix K1)
  await agentsDb.logProviderUsage({
    tenant_id: p.tenant_id,
    agent_id: p.aios_master_agent_id,
    skill_id: 'copilot:turn',
    provider: 'anthropic',
    model: MODEL,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut,
    cost_usd: messageCost,
    latency_ms: 0,
    is_fallback: false,
    is_sensitive: true,
  })
  await agentsDb.upsertBudget(
    p.aios_master_agent_id,
    p.tenant_id,
    month,
    messageCost,
    totalTokensIn + totalTokensOut,
  )

  // 5. Update conversation aggregates
  await db.update(copilotConversations).set({
    message_count: sql`${copilotConversations.message_count} + 2`,
    total_tokens: sql`${copilotConversations.total_tokens} + ${totalTokensIn + totalTokensOut}`,
    total_cost_usd: sql`${copilotConversations.total_cost_usd} + ${totalCost}`,
    last_message_at: new Date(),
    updated_at: new Date(),
  }).where(eq(copilotConversations.id, p.conversation_id))

  p.sse.write({
    type: 'turn_complete',
    total_tokens: totalTokensIn + totalTokensOut,
    total_cost_usd: totalCost,
    tool_call_count: toolCallCount,
  })

  // Suppress unused-import warnings for symbols Tasks 18+ will use
  void copilotToolCalls; void executeToolCall; void findToolByName; void ctx

  return { total_tokens: totalTokensIn + totalTokensOut, total_cost_usd: totalCost, tool_call_count: toolCallCount, stop_reason: lastStopReason }
}
