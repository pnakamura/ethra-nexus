import type {
  AIProvider,
  CompletionParams,
  CompletionResult,
  IProviderRegistry,
  ModuleId,
  ModuleProviderConfig,
  ProviderName,
} from '@ethra-nexus/core'
import { MODULE_PROVIDER_MAP } from '@ethra-nexus/core'
import { AnthropicProvider } from './anthropic.provider'
import { OpenRouterProvider } from './openrouter.provider'

export interface RegistryConfig {
  anthropicApiKey: string
  openrouterApiKey: string
  openrouterBaseUrl?: string
  // Overrides por variável de ambiente — NEXUS_PROVIDER_[MODULE]=provider:model
  moduleOverrides?: Partial<Record<ModuleId, { provider: ProviderName; model: string }>>
}

// Re-exported from core so callers can import from either location.
export type { CompleteOptions } from '@ethra-nexus/core'
import type { CompleteOptions } from '@ethra-nexus/core'

// ============================================================
// ProviderRegistry — roteamento de AI providers por módulo
//
// Regras (em ordem de prioridade):
// 1. force_sensitive === true → sempre Anthropic direto
// 2. moduleConfig.sensitive_data === true → sempre Anthropic direto
// 3. moduleOverride do .env → usa provider configurado
// 4. moduleConfig.primary → provider padrão do módulo
// 5. Fallback automático se provider primário falhar
// ============================================================
export class ProviderRegistry implements IProviderRegistry {
  private providers: Map<ProviderName, AnthropicProvider | OpenRouterProvider>
  private config: RegistryConfig

  constructor(config: RegistryConfig) {
    this.config = config
    this.providers = new Map<ProviderName, AnthropicProvider | OpenRouterProvider>([
      ['anthropic', new AnthropicProvider(config.anthropicApiKey)],
      ['openrouter', new OpenRouterProvider(config.openrouterApiKey, config.openrouterBaseUrl)],
    ])
  }

  async complete(
    moduleId: ModuleId,
    params: CompletionParams,
    options: CompleteOptions = {},
  ): Promise<CompletionResult> {
    if (process.env['NEXUS_MOCK_LLM'] === 'true') {
      return {
        content: 'Mock LLM response for testing',
        input_tokens: 10,
        output_tokens: 20,
        estimated_cost_usd: 0,
        latency_ms: 0,
        provider: 'mock' as ProviderName,
        model: 'mock',
        is_fallback: false,
      }
    }

    const moduleConfig: ModuleProviderConfig | undefined = MODULE_PROVIDER_MAP[moduleId]
    if (!moduleConfig) {
      throw new Error(`No provider config for module '${moduleId}'`)
    }

    const target = this.resolveTarget(moduleId, moduleConfig, options)
    const provider = this.providers.get(target.provider)

    if (!provider) {
      throw new Error(`Provider '${target.provider}' not configured`)
    }

    try {
      const result = await provider.complete({ ...params, model: target.model })
      return result
    } catch (primaryError) {
      // Sem fallback para módulos com dados sensíveis
      if (moduleConfig.sensitive_data || options.force_sensitive) {
        throw primaryError
      }

      // Tenta fallback se configurado
      if (moduleConfig.fallback) {
        const fallbackProvider = this.providers.get(moduleConfig.fallback.provider)
        if (!fallbackProvider) throw primaryError

        const result = await fallbackProvider.complete({
          ...params,
          model: moduleConfig.fallback.model,
        })
        return { ...result, is_fallback: true }
      }

      throw primaryError
    }
  }

  private resolveTarget(
    moduleId: ModuleId,
    moduleConfig: ModuleProviderConfig,
    options: CompleteOptions,
  ): { provider: ProviderName; model: string } {
    // Regra 1 e 2: dados sensíveis → sempre Anthropic
    if (options.force_sensitive || moduleConfig.sensitive_data) {
      return {
        provider: 'anthropic',
        model: moduleConfig.primary.provider === 'anthropic'
          ? moduleConfig.primary.model
          : 'claude-sonnet-4-6',
      }
    }

    // Regra 3: override por variável de ambiente
    const envOverride = this.config.moduleOverrides?.[moduleId]
    if (envOverride) {
      return envOverride
    }

    // Regra 4: provider padrão do módulo
    return moduleConfig.primary
  }

  getProvider(name: ProviderName): AIProvider {
    const provider = this.providers.get(name)
    if (!provider) throw new Error(`Provider '${name}' not registered`)
    return provider
  }
}

export function createRegistryFromEnv(): ProviderRegistry {
  const anthropicKey = process.env['ANTHROPIC_API_KEY']
  const openrouterKey = process.env['OPENROUTER_API_KEY']

  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set')
  if (!openrouterKey) throw new Error('OPENROUTER_API_KEY not set')

  // Parse NEXUS_PROVIDER_[MODULE]=provider:model overrides
  const moduleOverrides: Partial<Record<ModuleId, { provider: ProviderName; model: string }>> = {}
  const moduleIds: ModuleId[] = [
    'aios-master', 'agent-atendimento', 'agent-monitoramento',
    'agent-knowledge', 'agent-custom', 'wiki-ingest', 'wiki-query', 'wiki-lint',
  ]

  for (const moduleId of moduleIds) {
    const envKey = `NEXUS_PROVIDER_${moduleId.toUpperCase().replace(/-/g, '_')}`
    const envValue = process.env[envKey]
    if (envValue) {
      const [provider, ...modelParts] = envValue.split(':')
      if (provider === 'anthropic' || provider === 'openrouter') {
        moduleOverrides[moduleId] = { provider, model: modelParts.join(':') }
      }
    }
  }

  return new ProviderRegistry({
    anthropicApiKey: anthropicKey,
    openrouterApiKey: openrouterKey,
    openrouterBaseUrl: process.env['OPENROUTER_BASE_URL'],
    moduleOverrides,
  })
}
