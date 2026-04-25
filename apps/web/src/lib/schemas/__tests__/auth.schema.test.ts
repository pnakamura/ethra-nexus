import { describe, it, expect } from 'vitest'
import { loginSchema, signupSchema } from '../auth.schema'

describe('loginSchema', () => {
  it('accepts valid slug + password', () => {
    const result = loginSchema.safeParse({ slug: 'minha-empresa', password: 'secret123' })
    expect(result.success).toBe(true)
  })
  it('rejects empty slug', () => {
    const result = loginSchema.safeParse({ slug: '', password: 'secret123' })
    expect(result.success).toBe(false)
  })
})

describe('signupSchema', () => {
  it('accepts valid data', () => {
    const result = signupSchema.safeParse({ name: 'Minha Empresa', slug: 'minha-empresa', password: 'secret123', confirmPassword: 'secret123' })
    expect(result.success).toBe(true)
  })
  it('rejects invalid slug chars', () => {
    const result = signupSchema.safeParse({ name: 'X', slug: 'Empresa XYZ', password: 'secret123', confirmPassword: 'secret123' })
    expect(result.success).toBe(false)
  })
  it('rejects password mismatch', () => {
    const result = signupSchema.safeParse({ name: 'X', slug: 'x', password: 'aaa', confirmPassword: 'bbb' })
    expect(result.success).toBe(false)
  })
  it('rejects password shorter than 8 chars', () => {
    const result = signupSchema.safeParse({ name: 'X', slug: 'x', password: 'short', confirmPassword: 'short' })
    expect(result.success).toBe(false)
  })
})
