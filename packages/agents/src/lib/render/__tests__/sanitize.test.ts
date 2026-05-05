import { describe, it, expect } from 'vitest'
import { sanitizeDataForRenderPrompt } from '../sanitize'

describe('sanitizeDataForRenderPrompt', () => {
  it('escapes HTML special chars in strings', () => {
    expect(sanitizeDataForRenderPrompt('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
  })

  it('preserves non-string primitives', () => {
    expect(sanitizeDataForRenderPrompt(42)).toBe(42)
    expect(sanitizeDataForRenderPrompt(true)).toBe(true)
    expect(sanitizeDataForRenderPrompt(null)).toBe(null)
    expect(sanitizeDataForRenderPrompt(undefined)).toBe(undefined)
  })

  it('recurses into arrays', () => {
    expect(sanitizeDataForRenderPrompt(['<a>', 'b&', 'c']))
      .toEqual(['&lt;a&gt;', 'b&amp;', 'c'])
  })

  it('recurses into nested objects', () => {
    expect(sanitizeDataForRenderPrompt({
      name: '<b>Bold</b>',
      meta: { tag: 'a&b', count: 5 },
      list: ['<item>', 42],
    })).toEqual({
      name: '&lt;b&gt;Bold&lt;/b&gt;',
      meta: { tag: 'a&amp;b', count: 5 },
      list: ['&lt;item&gt;', 42],
    })
  })
})
