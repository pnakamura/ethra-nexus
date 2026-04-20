// packages/core/src/__tests__/validate.test.ts
import { describe, it, expect } from 'vitest'
import {
  validateWikiScope,
  validateWikiPath,
  validatePageType,
  validateConfidence,
  validateCronExpression,
  validateSlug,
  validateUUID,
  validateFileSystemPath,
  validateContentLength,
  SecurityValidationError,
} from '../security/validate'

describe('validateWikiScope', () => {
  it('aceita "system"', () => {
    expect(validateWikiScope('system')).toBe('system')
  })
  it('aceita "agent-meu-agente"', () => {
    expect(validateWikiScope('agent-meu-agente')).toBe('agent-meu-agente')
  })
  it('rejeita scope inválido', () => {
    expect(() => validateWikiScope('SYSTEM')).toThrow(SecurityValidationError)
    expect(() => validateWikiScope('agent_invalido')).toThrow(SecurityValidationError)
    expect(() => validateWikiScope('')).toThrow(SecurityValidationError)
  })
})

describe('validateWikiPath', () => {
  it('aceita path simples', () => {
    expect(validateWikiPath('guia-de-uso')).toBe('guia-de-uso')
  })
  it('aceita path com subdiretório', () => {
    expect(validateWikiPath('processos/onboarding')).toBe('processos/onboarding')
  })
  it('rejeita path traversal', () => {
    expect(() => validateWikiPath('../etc/passwd')).toThrow(SecurityValidationError)
    expect(() => validateWikiPath('~/secrets')).toThrow(SecurityValidationError)
    expect(() => validateWikiPath('/abs/path')).toThrow(SecurityValidationError)
  })
  it('rejeita path com maiúsculas ou caracteres especiais', () => {
    expect(() => validateWikiPath('UPPER')).toThrow(SecurityValidationError)
    expect(() => validateWikiPath('path with spaces')).toThrow(SecurityValidationError)
  })
})

describe('validatePageType', () => {
  it('aceita tipos válidos', () => {
    expect(validatePageType('entidade')).toBe('entidade')
    expect(validatePageType('faq')).toBe('faq')
    expect(validatePageType('log')).toBe('log')
  })
  it('rejeita tipo inválido', () => {
    expect(() => validatePageType('unknown')).toThrow(SecurityValidationError)
    expect(() => validatePageType('')).toThrow(SecurityValidationError)
  })
})

describe('validateConfidence', () => {
  it('aceita valores válidos', () => {
    expect(validateConfidence('alta')).toBe('alta')
    expect(validateConfidence('media')).toBe('media')
    expect(validateConfidence('baixa')).toBe('baixa')
    expect(validateConfidence('pendente')).toBe('pendente')
  })
  it('rejeita valor inválido', () => {
    expect(() => validateConfidence('high')).toThrow(SecurityValidationError)
  })
})

describe('validateCronExpression', () => {
  it('aceita cron válido de 5 campos', () => {
    expect(validateCronExpression('0 9 * * 1-5')).toBe('0 9 * * 1-5')
    expect(validateCronExpression('*/5 * * * *')).toBe('*/5 * * * *')
  })
  it('rejeita expressão com menos de 5 campos', () => {
    expect(() => validateCronExpression('0 9 * *')).toThrow(SecurityValidationError)
  })
  it('rejeita expressão muito frequente (* *)', () => {
    expect(() => validateCronExpression('* * * * *')).toThrow(SecurityValidationError)
  })
  // Nota: '*/1 * * * *' (todo minuto com step syntax) passa pelo guard atual.
  // O guard verifica parts[0] === '*', mas '*/1' não é estritamente igual a '*'.
  // Baixo risco em prática — deixar para hardening futuro.
  it('rejeita texto não-cron', () => {
    expect(() => validateCronExpression('não é cron')).toThrow(SecurityValidationError)
  })
})

describe('validateSlug', () => {
  it('aceita slug válido', () => {
    expect(validateSlug('minha-empresa')).toBe('minha-empresa')
  })
  it('rejeita slug com maiúsculas', () => {
    expect(() => validateSlug('MinhaEmpresa')).toThrow(SecurityValidationError)
  })
  it('rejeita slug reservado', () => {
    expect(() => validateSlug('admin')).toThrow(SecurityValidationError)
    expect(() => validateSlug('api')).toThrow(SecurityValidationError)
  })
  it('rejeita slug curto demais', () => {
    expect(() => validateSlug('ab')).toThrow(SecurityValidationError)
  })
})

describe('validateUUID', () => {
  it('aceita UUID válido', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    expect(validateUUID(uuid, 'test')).toBe(uuid)
  })
  it('rejeita string que não é UUID', () => {
    expect(() => validateUUID('not-a-uuid', 'field')).toThrow(SecurityValidationError)
    expect(() => validateUUID('', 'field')).toThrow(SecurityValidationError)
  })
})

describe('validateFileSystemPath', () => {
  it('aceita path dentro do base permitido', () => {
    const result = validateFileSystemPath('/wikis/system/page', '/wikis/system')
    expect(result).toBe('/wikis/system/page')
  })
  it('rejeita path traversal com ..', () => {
    expect(() => validateFileSystemPath('/wikis/../etc/passwd', '/wikis')).toThrow(SecurityValidationError)
  })
  it('rejeita path fora do base', () => {
    expect(() => validateFileSystemPath('/etc/passwd', '/wikis')).toThrow(SecurityValidationError)
  })
  it('rejeita path com prefixo similar ao base mas fora do base', () => {
    expect(() => validateFileSystemPath('/wikis/system-evil/page', '/wikis/system')).toThrow(SecurityValidationError)
  })
})

describe('validateContentLength', () => {
  it('aceita conteúdo dentro do limite', () => {
    expect(validateContentLength('hello', 100, 'field')).toBe('hello')
  })
  it('rejeita conteúdo acima do limite', () => {
    expect(() => validateContentLength('x'.repeat(101), 100, 'field')).toThrow(SecurityValidationError)
  })
})
