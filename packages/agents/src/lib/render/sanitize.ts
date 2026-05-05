// Escape HTML special chars in any string found within the structure.
// Used before passing user-controlled data (e.g. xlsx cell values) into
// the render prompt to mitigate prompt-injection that turns into XSS.

export function sanitizeDataForRenderPrompt(data: unknown): unknown {
  if (typeof data === 'string') {
    return data
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
  if (Array.isArray(data)) return data.map(sanitizeDataForRenderPrompt)
  if (data && typeof data === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) out[k] = sanitizeDataForRenderPrompt(v)
    return out
  }
  return data
}
