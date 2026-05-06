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
const ESTIMATED_COST_PER_TURN = 0.05

function maxToolsPerTurn(): number {
  return parseInt(process.env['COPILOT_MAX_TOOLS_PER_TURN'] ?? '10', 10)
}
function maxCostPerTurnUsd(): number {
  return parseFloat(process.env['COPILOT_MAX_COST_PER_TURN_USD'] ?? '0.50')
}

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

interface AssistantStepResult {
  blocks: ContentBlock[]
  tokens_in: number
  tokens_out: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  stop_reason: string
}

async function streamAssistantStep(args: {
  history: Array<{ role: 'user' | 'assistant'; content: ContentBlock[] }>
  system: string
  abortSignal: AbortSignal
  sse: SseWriter
}): Promise<AssistantStepResult> {
  const anth = getAnthropicClient()

  // Prompt caching: system prompt + tool list are static across turns and
  // across users in a tenant. cache_control: ephemeral → 5-min TTL. First
  // call writes (1.25× input price), subsequent calls within the window read
  // (0.1× input price). Net: ~70%+ savings on input tokens for the master,
  // since system + tools dwarf the per-turn message growth.
  const tools = getToolsForAnthropic(allCopilotTools)
  const lastTool = tools[tools.length - 1]
  const cachedTools = lastTool
    ? [...tools.slice(0, -1), { ...lastTool, cache_control: { type: 'ephemeral' as const } }]
    : tools

  const stream = await anth.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' as const } }],
    tools: cachedTools,
    messages: args.history,
    stream: true,
  }, { signal: args.abortSignal })

  const blocks: ContentBlock[] = []
  let currentText = ''
  let currentToolUse: ToolUseBlock | null = null
  let currentToolJson = ''
  let tokensIn = 0
  let tokensOut = 0
  let cacheCreate = 0
  let cacheRead = 0
  let stopReason = 'end_turn'

  for await (const ev of stream as AsyncIterable<{ type: string; [k: string]: unknown }>) {
    if (ev.type === 'message_start') {
      // Anthropic streams full input usage (incl. cache fields) in message_start.
      // message_delta later carries the cumulative output_tokens only.
      const msg = ev['message'] as {
        usage?: {
          input_tokens?: number
          output_tokens?: number
          cache_creation_input_tokens?: number
          cache_read_input_tokens?: number
        }
      }
      const u = msg?.usage
      if (u) {
        tokensIn += u.input_tokens ?? 0
        tokensOut += u.output_tokens ?? 0
        cacheCreate += u.cache_creation_input_tokens ?? 0
        cacheRead += u.cache_read_input_tokens ?? 0
      }
    } else if (ev.type === 'content_block_start') {
      const cb = ev['content_block'] as { type: string; id?: string; name?: string; input?: Record<string, unknown> }
      if (cb.type === 'text') {
        currentText = ''
      } else if (cb.type === 'tool_use') {
        currentToolUse = { type: 'tool_use', id: cb.id ?? '', name: cb.name ?? '', input: cb.input ?? {} }
        currentToolJson = ''
        args.sse.write({ type: 'tool_use_start', tool_use_id: currentToolUse.id, tool_name: currentToolUse.name })
      }
    } else if (ev.type === 'content_block_delta') {
      const delta = ev['delta'] as { type: string; text?: string; partial_json?: string }
      if (delta.type === 'text_delta' && delta.text) {
        currentText += delta.text
        args.sse.write({ type: 'text_delta', delta: delta.text })
      } else if (delta.type === 'input_json_delta' && delta.partial_json) {
        currentToolJson += delta.partial_json
      }
    } else if (ev.type === 'content_block_stop') {
      if (currentText) {
        blocks.push({ type: 'text', text: currentText })
        currentText = ''
      }
      if (currentToolUse) {
        if (currentToolJson) {
          try { currentToolUse.input = JSON.parse(currentToolJson) } catch { /* keep input as-is */ }
        }
        blocks.push(currentToolUse)
        currentToolUse = null
        currentToolJson = ''
      }
    } else if (ev.type === 'message_delta') {
      const md = ev['delta'] as { stop_reason?: string }
      const usage = ev['usage'] as { output_tokens?: number } | undefined
      if (md.stop_reason) stopReason = md.stop_reason
      if (usage && usage.output_tokens != null) {
        // message_delta usage carries cumulative output_tokens — replace,
        // don't add (would double-count the initial value from message_start).
        tokensOut = usage.output_tokens
      }
    }
  }

  return {
    blocks,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cache_creation_input_tokens: cacheCreate,
    cache_read_input_tokens: cacheRead,
    stop_reason: stopReason,
  }
}

// Sonnet 4.6 pricing (per MTok): input $3, output $15, cache write $3.75 (1.25×),
// cache read $0.30 (0.1×). cache_creation/read tokens are ALSO billed beyond the
// regular input_tokens — they don't substitute, they're additive at cheaper rates.
function blockCost(args: {
  tokens_in: number
  tokens_out: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}): number {
  return (
    (args.tokens_in / 1_000_000) * 3 +
    (args.tokens_out / 1_000_000) * 15 +
    (args.cache_creation_input_tokens / 1_000_000) * 3.75 +
    (args.cache_read_input_tokens / 1_000_000) * 0.3
  )
}

export async function executeCopilotTurn(p: ExecuteCopilotTurnParams): Promise<TurnResult> {
  const db = getDb()
  const ctx: ToolContext = {
    tenant_id: p.tenant_id,
    user_id: p.user_id,
    user_role: p.user_role,
    conversation_id: p.conversation_id,
  }
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

  // 2. Load history
  const historyRows = await db.select({
    role: copilotMessages.role, content: copilotMessages.content,
  })
    .from(copilotMessages)
    .where(eq(copilotMessages.conversation_id, p.conversation_id))
    .orderBy(asc(copilotMessages.created_at))

  let history = historyRows.map(r => ({
    role: r.role as 'user' | 'assistant',
    content: r.content as ContentBlock[],
  }))

  // 3. Agentic loop
  let totalIn = 0
  let totalOut = 0
  let totalCost = 0
  let toolCallCount = 0
  let lastStopReason = 'end_turn'
  let messagesPersistedInTurn = 1  // user message already counted

  while (true) {
    const step = await streamAssistantStep({
      history,
      system: p.system_prompt,
      abortSignal: p.abortSignal,
      sse: p.sse,
    })
    // Total billable input tokens = uncached + cache_write + cache_read.
    // We sum into tokens_in for downstream consumers (UI, budgets) so the
    // total token count stays meaningful; the cost field already reflects
    // the cheaper cached pricing via blockCost().
    const stepTokensInTotal =
      step.tokens_in + step.cache_creation_input_tokens + step.cache_read_input_tokens
    totalIn += stepTokensInTotal
    totalOut += step.tokens_out
    const stepCost = blockCost({
      tokens_in: step.tokens_in,
      tokens_out: step.tokens_out,
      cache_creation_input_tokens: step.cache_creation_input_tokens,
      cache_read_input_tokens: step.cache_read_input_tokens,
    })
    totalCost += stepCost
    lastStopReason = step.stop_reason

    const assistantRows = await db.insert(copilotMessages).values({
      conversation_id: p.conversation_id,
      tenant_id: p.tenant_id,
      role: 'assistant',
      content: step.blocks,
      model: MODEL,
      tokens_in: stepTokensInTotal,
      tokens_out: step.tokens_out,
      cost_usd: stepCost.toFixed(6),
      stop_reason: step.stop_reason,
    }).returning({ id: copilotMessages.id })
    const assistantMessageId = assistantRows[0]!.id
    messagesPersistedInTurn++

    p.sse.write({
      type: 'assistant_message_complete',
      message_id: assistantMessageId,
      tokens_in: stepTokensInTotal,
      tokens_out: step.tokens_out,
      cache_creation_input_tokens: step.cache_creation_input_tokens,
      cache_read_input_tokens: step.cache_read_input_tokens,
      cost_usd: stepCost,
      stop_reason: step.stop_reason,
    })

    // Per-step budget tracking (audit fix K1) — log AND upsert per step
    await agentsDb.logProviderUsage({
      tenant_id: p.tenant_id,
      agent_id: p.aios_master_agent_id,
      skill_id: 'copilot:turn',
      provider: 'anthropic',
      model: MODEL,
      tokens_in: stepTokensInTotal,
      tokens_out: step.tokens_out,
      cost_usd: stepCost,
      latency_ms: 0,
      is_fallback: false,
      is_sensitive: true,
    })
    await agentsDb.upsertBudget(
      p.aios_master_agent_id,
      p.tenant_id,
      month,
      stepCost,
      stepTokensInTotal + step.tokens_out,
    )

    // Check cost cap AFTER tracking (so the step that crossed the cap is still recorded)
    if (totalCost > maxCostPerTurnUsd()) {
      p.sse.write({ type: 'error', code: 'TURN_COST_EXCEEDED', message: `Turno excedeu orçamento de $${maxCostPerTurnUsd()} USD.` })
      await db.update(copilotMessages).set({ stop_reason: 'turn_cap_exceeded' }).where(eq(copilotMessages.id, assistantMessageId))
      lastStopReason = 'turn_cap_exceeded'
      break
    }

    history = [...history, { role: 'assistant', content: step.blocks }]

    if (step.stop_reason !== 'tool_use') break

    // Check tool count cap BEFORE executing this batch
    const blocksToolCount = step.blocks.filter(b => b.type === 'tool_use').length
    if (toolCallCount + blocksToolCount > maxToolsPerTurn()) {
      p.sse.write({ type: 'error', code: 'TURN_TOOLS_EXCEEDED', message: `Turno excedeu ${maxToolsPerTurn()} chamadas de tool.` })
      await db.update(copilotMessages).set({ stop_reason: 'turn_cap_exceeded' }).where(eq(copilotMessages.id, assistantMessageId))
      lastStopReason = 'turn_cap_exceeded'
      break
    }

    // Execute each tool_use block
    const toolResultBlocks: ToolResultBlock[] = []
    for (const block of step.blocks) {
      if (block.type !== 'tool_use') continue
      toolCallCount++
      const tool = findToolByName(block.name)

      let result: unknown
      let status = 'completed'
      let errorCode: string | null = null
      let durationMs = 0

      if (!tool) {
        result = { error: `Tool not found: ${block.name}` }
        status = 'error'
        errorCode = 'TOOL_NOT_FOUND'
      } else {
        const r = await executeToolCall(tool, block.input, ctx)
        durationMs = r.durationMs
        if (r.error) {
          result = { error: r.error }
          status = 'error'
          errorCode = r.error
        } else {
          result = r.result
        }
      }

      // Persist tool call
      await db.insert(copilotToolCalls).values({
        message_id: assistantMessageId,
        conversation_id: p.conversation_id,
        tenant_id: p.tenant_id,
        tool_use_id: block.id,
        tool_name: block.name,
        tool_input: block.input,
        tool_result: result as Record<string, unknown>,
        status,
        error_code: errorCode,
        duration_ms: durationMs,
      })

      // Wrap result for the model (defensive against prompt injection)
      const wrapped = `<tool_output tool="${block.name}">\n${JSON.stringify(result)}\n</tool_output>`
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: wrapped,
        is_error: status === 'error',
      })

      p.sse.write({ type: 'tool_use_complete', tool_use_id: block.id, status, duration_ms: durationMs })
    }

    // Append synthetic user message with tool_results
    await db.insert(copilotMessages).values({
      conversation_id: p.conversation_id,
      tenant_id: p.tenant_id,
      role: 'user',
      content: toolResultBlocks,
    })
    history = [...history, { role: 'user', content: toolResultBlocks }]
    messagesPersistedInTurn++
  }

  // 4. Update conversation aggregates
  await db.update(copilotConversations).set({
    message_count: sql`${copilotConversations.message_count} + ${messagesPersistedInTurn}`,
    total_tokens: sql`${copilotConversations.total_tokens} + ${totalIn + totalOut}`,
    total_cost_usd: sql`${copilotConversations.total_cost_usd} + ${totalCost}`,
    last_message_at: new Date(),
    updated_at: new Date(),
  }).where(eq(copilotConversations.id, p.conversation_id))

  p.sse.write({
    type: 'turn_complete',
    total_tokens: totalIn + totalOut,
    total_cost_usd: totalCost,
    tool_call_count: toolCallCount,
  })

  return {
    total_tokens: totalIn + totalOut,
    total_cost_usd: totalCost,
    tool_call_count: toolCallCount,
    stop_reason: lastStopReason,
  }
}
