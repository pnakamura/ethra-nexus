import type { JSONSchema7 } from 'json-schema'
import type Anthropic from '@anthropic-ai/sdk'

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

// Use Anthropic SDK's Tool type directly. Our JSONSchema7-typed input_schema
// satisfies the runtime shape but TS can't prove the index signature, so cast.
export type AnthropicToolSchema = Anthropic.Tool

// Anthropic tool names must match ^[a-zA-Z0-9_-]{1,128}$ — colons rejected.
// Transform `:` → `_` at the boundary (e.g. system:list_agents → system_list_agents).
export function getToolsForAnthropic(tools: CopilotTool[]): Anthropic.Tool[] {
  return tools.map(t => ({
    name: t.name.replace(/:/g, '_'),
    description: t.description,
    input_schema: t.input_schema as unknown as Anthropic.Tool['input_schema'],
  }))
}
