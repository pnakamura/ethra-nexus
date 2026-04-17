import OpenAI from 'openai'
import type { AIProvider, CompletionParams, CompletionResult } from '@ethra-nexus/core'
import { estimateCostUsd } from '@ethra-nexus/core'

// OpenRouter expõe interface compatível com OpenAI SDK
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter' as const
  private client: OpenAI

  constructor(apiKey: string, baseUrl = 'https://openrouter.ai/api/v1') {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      defaultHeaders: {
        'HTTP-Referer': 'https://ethranexus.com',
        'X-Title': 'Ethra Nexus',
      },
    })
  }

  async complete(
    params: CompletionParams & { model: string },
  ): Promise<CompletionResult> {
    const startMs = Date.now()

    const response = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.max_tokens ?? 4096,
      temperature: params.temperature ?? 0.3,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    })

    const choice = response.choices[0]
    if (!choice?.message.content) {
      throw new Error('OpenRouter returned empty content')
    }

    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0

    return {
      content: choice.message.content,
      provider: 'openrouter',
      model: params.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Date.now() - startMs,
      is_fallback: false,
      estimated_cost_usd: estimateCostUsd(params.model, inputTokens, outputTokens),
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list()
      return true
    } catch {
      return false
    }
  }
}
