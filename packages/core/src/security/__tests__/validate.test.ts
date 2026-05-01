import { describe, it, expect } from 'vitest'
import { validateMimeType, validateExpiresAt } from '../validate'

describe('validateMimeType', () => {
  it('accepts standard mime types', () => {
    expect(validateMimeType('application/pdf')).toBe('application/pdf')
    expect(validateMimeType('text/plain')).toBe('text/plain')
    expect(validateMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('rejects malformed strings', () => {
    expect(() => validateMimeType('')).toThrow()
    expect(() => validateMimeType('no-slash')).toThrow()
    expect(() => validateMimeType('a/b/c')).toThrow()
    expect(() => validateMimeType('UPPER/case')).not.toThrow()  // case-insensitive ok
    expect(() => validateMimeType('text/<script>')).toThrow()
  })
})

describe('validateExpiresAt', () => {
  it('accepts future ISO8601', () => {
    const future = new Date(Date.now() + 60_000 + 1000).toISOString()  // 61s in future to clear the 60s buffer
    expect(validateExpiresAt(future)).toBeInstanceOf(Date)
  })

  it('rejects past', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(() => validateExpiresAt(past)).toThrow(/in the past/i)
  })

  it('rejects malformed', () => {
    expect(() => validateExpiresAt('not-a-date')).toThrow()
    expect(() => validateExpiresAt('')).toThrow()
  })

  it('returns null when input is null/undefined', () => {
    expect(validateExpiresAt(null)).toBeNull()
    expect(validateExpiresAt(undefined)).toBeNull()
  })
})
