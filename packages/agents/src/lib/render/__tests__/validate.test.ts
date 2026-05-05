import { describe, it, expect } from 'vitest'
import { validateArtifactHtml } from '../validate'

describe('validateArtifactHtml', () => {
  it('accepts valid HTML with inline script', () => {
    const html = '<!DOCTYPE html><html><body><script>console.log("hi")</script></body></html>'
    expect(validateArtifactHtml(html)).toEqual({ ok: true })
  })

  it('accepts script src from cdn.jsdelivr.net (https)', () => {
    const html = '<!DOCTYPE html><html><head><script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script></head><body></body></html>'
    expect(validateArtifactHtml(html)).toEqual({ ok: true })
  })

  it('rejects HTML > 50KB', () => {
    const big = 'x'.repeat(51 * 1024)
    const html = `<!DOCTYPE html><html><body>${big}</body></html>`
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/50KB|exceeds/)
  })

  it('rejects inline event handler (onclick=)', () => {
    const html = '<!DOCTYPE html><html><body><button onclick="x()">go</button></body></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/event handler|on\*=/)
  })

  it('rejects inline event handler (onerror=)', () => {
    const html = '<!DOCTYPE html><html><body><img src="x" onerror="x()"></body></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/event handler|on\*=/)
  })

  it('rejects javascript: URL', () => {
    const html = '<!DOCTYPE html><html><body><a href="javascript:alert(1)">x</a></body></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/javascript:/)
  })

  it('rejects script src http:// (non-https)', () => {
    const html = '<!DOCTYPE html><html><head><script src="http://evil.com/x.js"></script></head></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/non-https/)
  })

  it('rejects script src from non-whitelisted host', () => {
    const html = '<!DOCTYPE html><html><head><script src="https://evil.com/x.js"></script></head></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/whitelisted|evil/)
  })

  it('rejects iframe with data: URL src', () => {
    const html = '<!DOCTYPE html><html><body><iframe src="data:text/html,<script>x()</script>"></iframe></body></html>'
    const r = validateArtifactHtml(html)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/data: URL in iframe/)
  })
})
