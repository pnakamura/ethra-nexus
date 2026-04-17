// ============================================================
// Rate Limiter — proteção contra abuso de AI providers
//
// Limita chamadas por tenant + módulo em janelas de tempo.
// Previne:
// - Custo descontrolado (milhares de chamadas em minutos)
// - DoS via API de terceiros
// - Abuso de quota por um tenant em cloud mode
//
// Implementação in-memory para self-hosted.
// Em cloud mode, substituir por Redis/Supabase.
// ============================================================

import type { ModuleId } from '../types/provider.types'

interface RateLimitEntry {
  count: number
  window_start: number
}

interface RateLimitConfig {
  // Chamadas permitidas por janela de tempo
  max_calls_per_window: number
  // Tamanho da janela em milissegundos
  window_ms: number
}

// Limites padrão por módulo — tunáveis por tenant via config
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  'aios-master':        { max_calls_per_window: 100,  window_ms: 3600_000 }, // 100/hora
  'agent-atendimento':  { max_calls_per_window: 500,  window_ms: 3600_000 }, // 500/hora
  'agent-monitoramento':{ max_calls_per_window: 1000, window_ms: 3600_000 }, // 1000/hora
  'agent-knowledge':    { max_calls_per_window: 200,  window_ms: 3600_000 }, // 200/hora
  'agent-custom':       { max_calls_per_window: 300,  window_ms: 3600_000 }, // 300/hora
  'wiki-ingest':        { max_calls_per_window: 50,   window_ms: 3600_000 }, // 50/hora
  'wiki-query':         { max_calls_per_window: 500,  window_ms: 3600_000 }, // 500/hora
  'wiki-lint':          { max_calls_per_window: 20,   window_ms: 3600_000 }, // 20/hora
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>()
  private customLimits = new Map<string, RateLimitConfig>()

  // Verifica e incrementa o contador. Retorna true se permitido.
  check(tenantId: string, moduleId: ModuleId): RateLimitResult {
    const key = `${tenantId}:${moduleId}`
    const now = Date.now()
    const config = this.customLimits.get(key) ?? DEFAULT_LIMITS[moduleId] ?? DEFAULT_LIMITS['aios-master']!

    const entry = this.entries.get(key)

    // Nova janela ou janela expirada
    if (!entry || (now - entry.window_start) > config.window_ms) {
      this.entries.set(key, { count: 1, window_start: now })
      return {
        allowed: true,
        remaining: config.max_calls_per_window - 1,
        reset_at: new Date(now + config.window_ms).toISOString(),
      }
    }

    // Dentro da janela — verifica limite
    if (entry.count >= config.max_calls_per_window) {
      return {
        allowed: false,
        remaining: 0,
        reset_at: new Date(entry.window_start + config.window_ms).toISOString(),
      }
    }

    // Permitido — incrementa
    entry.count++
    return {
      allowed: true,
      remaining: config.max_calls_per_window - entry.count,
      reset_at: new Date(entry.window_start + config.window_ms).toISOString(),
    }
  }

  // Configura limites customizados para um tenant/módulo
  setLimit(tenantId: string, moduleId: ModuleId, config: RateLimitConfig): void {
    this.customLimits.set(`${tenantId}:${moduleId}`, config)
  }

  // Limpa entradas expiradas (chamar periodicamente)
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      const config = this.customLimits.get(key) ?? { window_ms: 3600_000 }
      if ((now - entry.window_start) > config.window_ms * 2) {
        this.entries.delete(key)
      }
    }
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  reset_at: string    // ISO timestamp
}
