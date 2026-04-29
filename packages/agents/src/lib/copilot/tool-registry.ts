import type { JSONSchema7 } from 'json-schema'

export interface ToolContext {
  tenant_id: string
  user_id: string
  user_role: 'admin' | 'member'
}

export interface CopilotTool<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  input_schema: JSONSchema7
  permission: 'all_members' | 'admin_only'
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>
}

export interface ToolCallResult<T = unknown> {
  result: T | null
  durationMs: number
  error?: string
}

export async function executeToolCall<TInput, TOutput>(
  tool: CopilotTool<TInput, TOutput>,
  input: TInput,
  ctx: ToolContext,
): Promise<ToolCallResult<TOutput>> {
  if (tool.permission === 'admin_only' && ctx.user_role !== 'admin') {
    return { result: null, durationMs: 0, error: 'PERMISSION_DENIED' }
  }
  const start = Date.now()
  try {
    const result = await tool.handler(input, ctx)
    return { result, durationMs: Date.now() - start }
  } catch (err) {
    return {
      result: null,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'UNKNOWN',
    }
  }
}

// Anthropic tool schema format (subset of Anthropic.Tool)
// Anthropic SDK requires input_schema.type === 'object' literal.
export interface AnthropicToolSchema {
  name: string
  description: string
  input_schema: JSONSchema7 & { type: 'object' }
}

export function getToolsForAnthropic(tools: CopilotTool[]): AnthropicToolSchema[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: { ...t.input_schema, type: 'object' as const },
  }))
}
