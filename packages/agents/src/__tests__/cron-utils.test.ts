// packages/agents/src/__tests__/cron-utils.test.ts
import { describe, it, expect } from 'vitest'
import { validateCron, calcNextRun } from '../lib/scheduler/cron-utils'

describe('validateCron', () => {
  it('aceita expressão válida padrão', () => {
    expect(validateCron('0 9 * * 1-5')).toBe(true)
    expect(validateCron('*/5 * * * *')).toBe(true)
    expect(validateCron('0 0 1 * *')).toBe(true)
    expect(validateCron('30 18 * * 0')).toBe(true)
  })
  it('rejeita texto inválido', () => {
    expect(validateCron('não é cron')).toBe(false)
    expect(validateCron('a b c d e')).toBe(false) // caracteres inválidos
    expect(validateCron('* * * * * * *')).toBe(false) // 7 campos
  })
  it('rejeita valores fora do intervalo', () => {
    expect(validateCron('99 9 * * *')).toBe(false) // minuto > 59
    expect(validateCron('0 25 * * *')).toBe(false) // hora > 23
  })
})

describe('calcNextRun', () => {
  it('retorna uma Date no futuro', () => {
    const next = calcNextRun('*/5 * * * *')
    expect(next).toBeInstanceOf(Date)
    expect(next.getTime()).toBeGreaterThan(Date.now())
  })
  it('próxima execução é em no máximo 5 minutos para */5', () => {
    const next = calcNextRun('*/5 * * * *')
    const diffMs = next.getTime() - Date.now()
    expect(diffMs).toBeLessThanOrEqual(5 * 60 * 1000)
  })
  it('aceita timezone como parâmetro (não lança)', () => {
    expect(() => calcNextRun('0 9 * * *', 'America/Sao_Paulo')).not.toThrow()
  })
  it('usa UTC como timezone padrão', () => {
    expect(() => calcNextRun('0 9 * * *')).not.toThrow()
  })
})
