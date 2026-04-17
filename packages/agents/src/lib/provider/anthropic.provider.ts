import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, CompletionParams, CompletionResult } from '@ethra-nexus/core'
import { estimateCostUsd } from '@ethra-nexus/core'

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async complete(
    params: CompletionParams & { model: string },
  ): Promise<CompletionResult> {
    const startMs = Date.now()

    const systemMessage = params.messages.find((m) => m.role === 'system')
    const userMessages = params.messages.filter((m) => m.role !== 'system')

    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.max_tokens ?? 4096,
      temperature: params.temperature ?? 0.3,
      system: systemMessage?.content,
      messages: userMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    })

    const content = response.content[0]
    if (content?.type !== 'text') {
      throw new Error('Anthropic returned non-text content')
    }

    return {
      content: content.text,
      provider: 'anthropic',
      model: params.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      latency_ms: Date.now() - startMs,
      is_fallback: false,
      estimated_cost_usd: estimateCostUsd(params.model, response.usage.input_tokens, response.usage.output_tokens),
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Lightweight check: attempt a minimal API call
      await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return true
    } catch {
      return false
    }
  }
}
