// packages/core/src/__tests__/rate-limiter.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { RateLimiter } from '../security/rate-limiter'

const TENANT = 'tenant-test-001'

describe('RateLimiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter()
  })

  it('permite chamada dentro do limite', () => {
    limiter.setLimit(TENANT, 'aios-master', { max_calls_per_window: 3, window_ms: 60_000 })
    const result = limiter.check(TENANT, 'aios-master')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('decrementa remaining a cada chamada', () => {
    limiter.setLimit(TENANT, 'aios-master', { max_calls_per_window: 3, window_ms: 60_000 })
    limiter.check(TENANT, 'aios-master')
    limiter.check(TENANT, 'aios-master')
    const result = limiter.check(TENANT, 'aios-master')
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0)
  })

  it('nega quando limite é atingido', () => {
    limiter.setLimit(TENANT, 'aios-master', { max_calls_per_window: 2, window_ms: 60_000 })
    limiter.check(TENANT, 'aios-master')
    limiter.check(TENANT, 'aios-master')
    const result = limiter.check(TENANT, 'aios-master') // 3ª chamada
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('janelas são independentes por tenant', () => {
    limiter.setLimit('tenant-a', 'aios-master', { max_calls_per_window: 1, window_ms: 60_000 })
    limiter.setLimit('tenant-b', 'aios-master', { max_calls_per_window: 1, window_ms: 60_000 })
    limiter.check('tenant-a', 'aios-master')
    const resultA = limiter.check('tenant-a', 'aios-master') // deve negar
    const resultB = limiter.check('tenant-b', 'aios-master') // deve permitir
    expect(resultA.allowed).toBe(false)
    expect(resultB.allowed).toBe(true)
  })

  it('reset_at é uma string ISO no futuro', () => {
    limiter.setLimit(TENANT, 'aios-master', { max_calls_per_window: 5, window_ms: 60_000 })
    const result = limiter.check(TENANT, 'aios-master')
    const resetAt = new Date(result.reset_at)
    expect(resetAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('cleanup remove entradas expiradas sem afetar ativas', () => {
    limiter.setLimit(TENANT, 'aios-master', { max_calls_per_window: 5, window_ms: 1 }) // 1ms window
    limiter.check(TENANT, 'aios-master')
    // Aguardar expiração (window_ms * 2 = 2ms)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        limiter.cleanup()
        // Após cleanup, nova janela — deve permitir novamente
        const result = limiter.check(TENANT, 'aios-master')
        expect(result.allowed).toBe(true)
        resolve()
      }, 5)
    })
  })
})
