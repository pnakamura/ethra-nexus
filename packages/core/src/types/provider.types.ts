// ============================================================
// Provider — abstração multi-AI com roteamento por agente
//
// Hierarquia de resolução de provider (em ordem de prioridade):
//
//   1. SkillConfig.provider_override   → definido na skill do agente
//   2. Agent env override              → NEXUS_PROVIDER_{AGENT_SLUG}_{SKILL}
//   3. SYSTEM_PROVIDER_MAP[skill_id]   → default por skill (este arquivo)
//   4. Tenant config.default_provider  → fallback do tenant
//
// Regra inviolável:
//   sensitive_data === true → sempre Anthropic direto, sem fallback
//
// ADR-004: Anthropic para dados sensíveis (LGPD)
//          OpenRouter como gateway para providers secundários
// ============================================================

export type ProviderName = 'anthropic' | 'openrouter'

export interface ProviderTarget {
  provider: ProviderName
  model: string
}

export interface SkillProviderConfig {
  primary: ProviderTarget
  fallback?: ProviderTarget
  sensitive_data: boolean
}

// ── Mensagens e Completions ──────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionParams {
  messages: Message[]
  max_tokens?: number
  temperature?: number
  sensitive_data?: boolean    // override pontual → força Anthropic
  agent_id?: string           // para tracking de custo por agente
  skill_id?: string           // para tracking por skill
}

export interface CompletionResult {
  content: string
  provider: ProviderName
  model: string
  input_tokens: number
  output_tokens: number
  latency_ms: number
  is_fallback: boolean
  estimated_cost_usd: number  // custo estimado desta chamada
}

export interface AIProvider {
  readonly name: ProviderName
  complete(params: CompletionParams & { model: string }): Promise<CompletionResult>
  isAvailable(): Promise<boolean>
}

// ── Usage Log ────────────────────────────────────────────────

export interface ProviderUsageLog {
  id: string
  tenant_id: string
  agent_id: string
  skill_id: string
  provider: ProviderName
  model: string
  input_tokens: number
  output_tokens: number
  latency_ms: number
  is_fallback: boolean
  is_sensitive_data: boolean
  estimated_cost_usd: number
  created_at: string
}

// ── Mapa de provider padrão por skill ────────────────────────
//
// Este mapa define os DEFAULTS do sistema. Cada agente pode
// sobrescrevê-los via SkillConfig.provider_override.
//
// Lógica de custo:
// - Skills que processam dados sensíveis → Anthropic (LGPD)
// - Skills de monitoramento/lint → Groq via OpenRouter (custo baixo)
// - Skills de análise longa → Gemini via OpenRouter (1M ctx)

import type { BuiltinSkillId } from './agent.types'

export const SYSTEM_PROVIDER_MAP: Record<BuiltinSkillId, SkillProviderConfig> = {
  // ── Wiki skills ────────────────────────────────────────
  'wiki:query': {
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    sensitive_data: true,
  },
  'wiki:ingest': {
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    sensitive_data: true,
  },
  'wiki:lint': {
    primary: { provider: 'openrouter', model: 'groq/llama-3.1-8b-instant' },
    fallback: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    sensitive_data: false,
  },

  // ── Channel skills ─────────────────────────────────────
  'channel:respond': {
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    sensitive_data: true,   // respostas podem conter dados de clientes
  },
  'channel:proactive': {
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    sensitive_data: true,
  },

  // ── Report skills ──────────────────────────────────────
  'report:generate': {
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    sensitive_data: true,
  },

  // ── Monitor skills ─────────────────────────────────────
  'monitor:health': {
    primary: { provider: 'openrouter', model: 'groq/llama-3.1-8b-instant' },
    fallback: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    sensitive_data: false,
  },
  'monitor:alert': {
    primary: { provider: 'openrouter', model: 'groq/llama-3.1-8b-instant' },
    fallback: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    sensitive_data: false,
  },

  // ── Data skills ────────────────────────────────────────
  'data:analyze': {
    primary: { provider: 'openrouter', model: 'google/gemini-2.5-pro' },
    fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    sensitive_data: false,   // dados para análise são anonimizados
  },
  'data:extract': {
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    sensitive_data: true,    // documentos brutos podem ter dados pessoais
  },
}

// ── Aliases de compatibilidade ────────────────────────────────
// O ProviderRegistry usa ModuleId (chaves com hífens: 'wiki-ingest')
// As skills usam SkillId (chaves com dois-pontos: 'wiki:ingest')
// Estes aliases permitem o Registry funcionar sem quebrar a API de skills

export type ModuleId = string  // 'wiki-ingest' | 'wiki-query' | etc.
export type ModuleProviderConfig = SkillProviderConfig

// ── Opções de completion ──────────────────────────────────────

export interface CompleteOptions {
  // Força Anthropic independentemente da config do módulo.
  // Usar quando o contexto da chamada contém dados sensíveis (LGPD).
  force_sensitive?: boolean
}

// ── Interface de ProviderRegistry ────────────────────────────
//
// Contrato mínimo que os consumidores (ex: packages/wiki) esperam do
// registry de providers. A implementação concreta vive em
// packages/agents/src/lib/provider/registry.ts.
//
// Definida aqui (core) para quebrar a dependência circular:
//   wiki → agents → wiki

export interface IProviderRegistry {
  complete(
    moduleId: ModuleId,
    params: CompletionParams,
    options?: CompleteOptions,
  ): Promise<CompletionResult>
}

// Gera MODULE_PROVIDER_MAP convertendo skill_id → module_id
function buildModuleMap(
  skillMap: Record<string, SkillProviderConfig>,
): Record<string, SkillProviderConfig> {
  const moduleMap: Record<string, SkillProviderConfig> = {}
  for (const [skillId, config] of Object.entries(skillMap)) {
    const moduleId = skillId.replace(':', '-')
    moduleMap[moduleId] = config
    moduleMap[skillId] = config // permite lookup por ambos os formatos
  }
  return moduleMap
}

export const MODULE_PROVIDER_MAP = buildModuleMap(SYSTEM_PROVIDER_MAP)

// Converte skill_id para module_id: 'wiki:ingest' → 'wiki-ingest'
export function skillToModuleId(skillId: string): ModuleId {
  return skillId.replace(':', '-')
}

// ── Estimativa de custo por modelo ───────────────────────────
// Referência: preços Abril 2026
// Usado para calcular estimated_cost_usd no CompletionResult

export const MODEL_COST_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':            { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001':    { input: 0.25,  output: 1.25 },
  'groq/llama-3.1-8b-instant':   { input: 0.06,  output: 0.06 },
  'google/gemini-2.5-pro':       { input: 1.25,  output: 5.00 },
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const costs = MODEL_COST_PER_MILLION_TOKENS[model]
  if (!costs) return 0

  return (
    (inputTokens / 1_000_000) * costs.input +
    (outputTokens / 1_000_000) * costs.output
  )
}
